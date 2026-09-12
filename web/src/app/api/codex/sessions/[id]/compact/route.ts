import type { CodexRunEvent } from '@/lib/api'
import { registerLiveCodexMessages } from '@/lib/server/codex-live-messages'
import { projectCodexRunEvent } from '@/lib/server/codex-message-projection'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import {
    finishActiveCodexRun,
    isCodexRunInterruptedError,
    reserveActiveCodexRun,
    runNovelCodexCompaction,
} from '@/lib/server/codex-app-server'
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
    const now = new Date()
    const currentMessages = parseCodexSessionMessages(existing.messagesJson)
    const activeRun = reserveActiveCodexRun(id)
    if (!activeRun) {
        return NextResponse.json({ detail: 'Codex session is already running.' }, { status: 409 })
    }

    let claimResult: { count: number }
    try {
        claimResult = await prisma.codexSession.updateMany({
            where: existing.status === 'running'
                ? { id, ownerId: user.userId, status: 'running', updatedAt: existing.updatedAt }
                : { id, ownerId: user.userId, status: existing.status },
            data: {
                draftContent: '',
                status: 'running',
                lastError: null,
                unreadCompletionAt: null,
                updatedAt: now,
            },
        })
    } catch (error) {
        finishActiveCodexRun(activeRun)
        throw error
    }
    if (claimResult.count !== 1) {
        finishActiveCodexRun(activeRun)
        return NextResponse.json({ detail: 'Codex session is already running.' }, { status: 409 })
    }

    const runInput = {
        activeRun,
        sessionId: existing.id,
        ownerId: user.userId,
        novelId: existing.novelId,
        codexThreadId: existing.codexThreadId,
        codexConnectionId: existing.codexConnectionId,
        reviewLevel: existing.reviewLevel,
        modelId: existing.modelId,
        serviceTier: existing.serviceTier,
    }

    const streamState = { closed: false }
    const bodyStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: string, data: unknown) => {
                if (streamState.closed) return
                try {
                    controller.enqueue(encodeSse(event, data))
                } catch {
                    streamState.closed = true
                }
            }
            const close = () => {
                if (streamState.closed) return
                streamState.closed = true
                try {
                    controller.close()
                } catch {
                    return
                }
            }
            const streamedMessages = [...currentMessages]
            const releaseLiveMessages = registerLiveCodexMessages(id, streamedMessages)
            let contextWindow: CodexContextWindow | null = null

            const upsertEventMessage = (event: CodexRunEvent) => {
                const message: CodexSessionMessage = {
                    id: event.id,
                    role: 'event',
                    kind: event.kind,
                    workStatus: event.workStatus,
                    toolInput: event.toolInput,
                    attachments: event.attachments,
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
                            send('event', projectCodexRunEvent(event))
                        },
                        onContextWindow: (nextContextWindow) => {
                            contextWindow = nextContextWindow
                            send('context_window', { contextWindow: nextContextWindow })
                        },
                        onRateLimits: (rateLimits, connectionId) => {
                            send('rate_limits', { rateLimits, connectionId })
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
                        status: 'idle',
                        lastError: null,
                        updatedAt: new Date(),
                    },
                })

                send('done', { session: serializeCodexSession(session) })
            } catch (error) {
                if (isCodexRunInterruptedError(error)) {
                    const session = await prisma.codexSession.update({
                        where: { id },
                        data: {
                            messagesJson: JSON.stringify(streamedMessages),
                            status: 'idle',
                            lastError: null,
                            updatedAt: new Date(),
                        },
                    })
                    send('done', { session: serializeCodexSession(session) })
                    return
                }
                const message = error instanceof Error ? error.message : 'Codex compaction failed.'
                const failedAt = new Date()
                const session = await prisma.codexSession.update({
                    where: { id },
                    data: {
                        messagesJson: JSON.stringify(streamedMessages),
                        status: 'error',
                        lastError: message,
                        unreadCompletionAt: failedAt,
                        updatedAt: failedAt,
                    },
                })

                send('error', { session: serializeCodexSession(session), detail: message })
            } finally {
                releaseLiveMessages()
                finishActiveCodexRun(activeRun)
                close()
            }
        },
        cancel() {
            streamState.closed = true
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
