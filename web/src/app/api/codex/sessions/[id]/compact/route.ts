import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { runNovelCodexCompaction } from '@/lib/server/codex-app-server'
import {
    type CodexContextWindow,
    parseCodexSessionMessages,
    serializeCodexSession,
    type CodexSessionMessage,
} from '@/lib/server/codex-session'

interface RouteContext {
    params: Promise<unknown>
}

const prisma = getPrismaClient({ ensureModel: 'codexSession' })
const encoder = new TextEncoder()

async function getRouteId(params: Promise<unknown>) {
    const resolved = await params
    return typeof resolved === 'object' && resolved !== null && typeof (resolved as { id?: unknown }).id === 'string'
        ? (resolved as { id: string }).id
        : ''
}

function encodeSse(event: string, data: unknown) {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

type CodexRouteRunEvent = {
    id: string
    kind: string
    title: string
    content: string
    createdAt: string
}

// Manually compact the session's Codex thread (the `/compact` slash command). Compaction streams
// the same `turn/*`/`item/*` notifications as a normal turn, so the route mirrors the message
// route's SSE shape — minus the user message — and persists the resulting "Context compacted"
// divider so it survives a reload.
export async function POST(request: NextRequest, { params }: RouteContext) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const id = await getRouteId(params)
    const existing = await prisma.codexSession.findFirst({
        where: { id, ownerId: user.userId },
    })
    if (!existing) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })
    if (!existing.codexThreadId) {
        return NextResponse.json({ detail: 'This session has no Codex thread to compact yet.' }, { status: 400 })
    }
    if (existing.status === 'running') {
        return NextResponse.json({ detail: 'Codex session is already running.' }, { status: 409 })
    }

    const now = new Date()
    const currentMessages = parseCodexSessionMessages(existing.messagesJson)

    await prisma.codexSession.update({
        where: { id },
        data: {
            draftContent: '',
            status: 'running',
            lastError: null,
            updatedAt: now,
        },
    })

    const runInput = {
        sessionId: existing.id,
        ownerId: user.userId,
        novelId: existing.novelId,
        codexThreadId: existing.codexThreadId,
        codexConnectionId: existing.codexConnectionId,
        reviewLevel: existing.reviewLevel,
        modelId: existing.modelId,
        serviceTier: existing.serviceTier,
    }

    const bodyStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: string, data: unknown) => {
                controller.enqueue(encodeSse(event, data))
            }
            const streamedMessages = [...currentMessages]
            let contextWindow: CodexContextWindow | null = null

            const upsertEventMessage = (event: CodexRouteRunEvent) => {
                const message: CodexSessionMessage = {
                    id: event.id,
                    role: 'event',
                    kind: event.kind,
                    content: [event.title, event.content].filter(Boolean).join('\n\n'),
                    createdAt: event.createdAt,
                }
                const index = streamedMessages.findIndex((item) => item.id === event.id)
                if (index >= 0) streamedMessages[index] = message
                else streamedMessages.push(message)
            }

            try {
                const result = await runNovelCodexCompaction({
                    ...runInput,
                    stream: {
                        onEvent: (event) => {
                            upsertEventMessage(event)
                            send('event', event)
                        },
                        onContextWindow: (nextContextWindow) => {
                            contextWindow = nextContextWindow
                            send('context_window', { contextWindow: nextContextWindow })
                        },
                    },
                })
                contextWindow = result.contextWindow ?? contextWindow

                // Attach the post-compaction usage to the divider so the composer's context bar
                // reflects the freed-up window once compaction lands.
                if (contextWindow) {
                    for (let index = streamedMessages.length - 1; index >= 0; index -= 1) {
                        if (streamedMessages[index]?.kind === 'context_compaction') {
                            streamedMessages[index] = { ...streamedMessages[index], contextWindow }
                            break
                        }
                    }
                }

                const session = await prisma.codexSession.update({
                    where: { id },
                    data: {
                        codexThreadId: result.threadId,
                        codexConnectionId: result.connectionId,
                        messagesJson: JSON.stringify(streamedMessages),
                        draftContent: '',
                        status: 'idle',
                        lastError: null,
                        updatedAt: new Date(),
                    },
                })

                send('done', { session: serializeCodexSession(session) })
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Codex compaction failed.'
                const session = await prisma.codexSession.update({
                    where: { id },
                    data: {
                        messagesJson: JSON.stringify(streamedMessages),
                        draftContent: '',
                        status: 'error',
                        lastError: message,
                        updatedAt: new Date(),
                    },
                })

                send('error', { session: serializeCodexSession(session), detail: message })
            } finally {
                controller.close()
            }
        },
    })

    return new Response(bodyStream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    })
}
