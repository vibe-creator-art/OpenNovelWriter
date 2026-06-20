import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { normalizeManagedAttachmentUrls } from '@/lib/server/storage'
import { getPrismaClient } from '@/lib/db'
import { runNovelCodexTurn } from '@/lib/server/codex-app-server'
import { readSkill } from '@/lib/server/skill-storage'
import { getNovelWorkspaceTermFileMap } from '@/lib/server/novel-workspace'
import { seedSkillSessionArtifact } from '@/lib/server/codex-skill-session'
import {
    type CodexContextWindow,
    createCodexMessageId,
    createCodexSessionTitle,
    normalizeCodexString,
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
    attachments?: string[]
    createdAt: string
}

function toEventMessages(events: CodexRouteRunEvent[]) {
    return events.map((event): CodexSessionMessage => ({
        id: event.id,
        role: 'event',
        kind: event.kind,
        content: [event.title, event.content].filter(Boolean).join('\n\n'),
        attachments: event.attachments ?? [],
        createdAt: event.createdAt,
    }))
}

function appendAssistantDeltaMessage(messages: CodexSessionMessage[], delta: string, id: string, createdAt: string) {
    const existing = messages.find((message) => message.id === id)
    if (existing) {
        existing.content += delta
        return
    }

    messages.push({
        id,
        role: 'assistant',
        content: delta,
        createdAt,
    })
}

function upsertPlanDeltaMessage(messages: CodexSessionMessage[], event: { id: string; delta: string; createdAt: string }) {
    const existing = messages.find((message) => message.id === event.id)
    if (existing) {
        const existingContent = existing.content.split(/\n\n/u).slice(1).join('\n\n')
        existing.content = ['Proposed Plan', `${existingContent}${event.delta}`].join('\n\n')
        return
    }

    messages.push({
        id: event.id,
        role: 'event',
        kind: 'plan',
        content: ['Proposed Plan', event.delta].join('\n\n'),
        createdAt: event.createdAt,
    })
}

function upsertEventMessage(messages: CodexSessionMessage[], event: CodexRouteRunEvent) {
    const message: CodexSessionMessage = {
        id: event.id,
        role: 'event',
        kind: event.kind,
        content: [event.title, event.content].filter(Boolean).join('\n\n'),
        attachments: event.attachments ?? [],
        createdAt: event.createdAt,
    }
    const index = messages.findIndex((item) => item.id === event.id)
    if (index >= 0) {
        messages[index] = message
    } else {
        messages.push(message)
    }
}

function attachContextWindowToLastAssistant(messages: CodexSessionMessage[], contextWindow: CodexContextWindow | null) {
    if (!contextWindow) return
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (message?.role === 'assistant') {
            messages[index] = { ...message, contextWindow }
            return
        }
    }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const id = await getRouteId(params)
    const existing = await prisma.codexSession.findFirst({
        where: { id, ownerId: user.userId },
    })
    if (!existing) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })
    if (
        existing.category !== 'general' &&
        existing.category !== 'scene_operation' &&
        existing.category !== 'scene_continuation'
    ) {
        return NextResponse.json({ detail: 'This Codex session category is not runnable yet.' }, { status: 400 })
    }
    if (existing.status === 'running') {
        return NextResponse.json({ detail: 'Codex session is already running.' }, { status: 409 })
    }

    const body = await request.json().catch(() => null)
    const content = normalizeCodexString(body?.content).trim()
    if (!content) return NextResponse.json({ detail: 'Message content is required.' }, { status: 400 })
    const stream = body?.stream === true
    const attachments = normalizeManagedAttachmentUrls(body?.attachments)

    // Skill mentions are stored in the message as `[name](skill:SKILL_ID)` (parallel to model
    // mentions). Collect their ids from the content (and any explicit `skillIds` in the body),
    // resolve to `{ id, name }` for the turn's skill input items, and rewrite the tokens to
    // Codex-native `$name` in the prompt that is actually sent to the model.
    const bodySkillIds = Array.isArray(body?.skillIds)
        ? (body.skillIds as unknown[]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : []
    const contentSkillIds: string[] = []
    for (const match of content.matchAll(/\[[^\]]+\]\(skill:([^)]+)\)/g)) {
        if (match[1]) contentSkillIds.push(match[1])
    }
    const uniqueSkillIds = [...new Set([...contentSkillIds, ...bodySkillIds])]
    const skillRefs = (
        await Promise.all(
            uniqueSkillIds.map(async (skillId) => {
                const skill = await readSkill(user.userId, skillId).catch(() => null)
                return skill ? { id: skill.id, name: skill.name } : null
            })
        )
    ).filter((ref): ref is { id: string; name: string } => ref !== null)

    // Term mentions `[title](term:TERM_ID)` point Codex at the read-only Markdown file the term is
    // projected to under `novel/terms/`. Resolve each id to its (collision-free) file name so the
    // rewritten instruction names an exact path Codex can open.
    const contentTermIds: string[] = []
    for (const match of content.matchAll(/\[[^\]]+\]\(term:([^)]+)\)/g)) {
        if (match[1]) contentTermIds.push(match[1])
    }
    const termFileById = contentTermIds.length > 0
        ? await getNovelWorkspaceTermFileMap(user.userId, existing.novelId)
        : new Map<string, { title: string; fileName: string }>()

    const promptText = content
        .replace(/\[([^\]]+)\]\(skill:([^)]+)\)/g, (_full, label: string) => `$${label}`)
        // A continuation panel reference becomes an explicit instruction carrying the panelId,
        // which Codex passes to get_continuation_draft / set_continuation_draft to write the result.
        .replace(
            /\[([^\]]+)\]\(continuation:([^:)]+):([^:)]+):([^)]+)\)/g,
            (_full, label: string, chapterId: string, sceneId: string, panelId: string) =>
                `${label} (scene-continuation panel — write your result here with set_continuation_draft: panelId=${panelId}, chapterId=${chapterId}, sceneId=${sceneId})`
        )
        // A term reference becomes an explicit instruction to read that term's projected file.
        .replace(/\[([^\]]+)\]\(term:([^)]+)\)/g, (_full, label: string, termId: string) => {
            const entry = termFileById.get(termId)
            return entry
                ? `${label} (term — read its full details in novel/terms/${entry.fileName} before responding)`
                : label
        })
        // A snippet reference points Codex at the snippet's projected file (keyed by id).
        .replace(
            /\[([^\]]+)\]\(snippet:([^)]+)\)/g,
            (_full, label: string, snippetId: string) =>
                `${label} (snippet — read its full content in novel/snippets/${snippetId}.md before responding)`
        )
        // A chapter reference points Codex at that chapter's projected file (keyed by chapter id).
        .replace(
            /\[([^\]]+)\]\(chapter:([^)]+)\)/g,
            (_full, label: string, chapterId: string) =>
                `${label} (章 — read this chapter's full content in novel/chapters/${chapterId}.md before responding)`
        )
        // A volume (act) has no single file — point Codex at the volume's section in the outline,
        // where it can read the per-chapter summaries and open the chapter files it actually needs.
        .replace(
            /\[([^\]]+)\]\(act:([^)]+)\)/g,
            (_full, label: string, actNumber: string) =>
                `${label} (卷 — read the section marked \`<!-- act_number: ${actNumber} -->\` in novel/outline.md for this volume's chapter structure and summaries, then open the relevant novel/chapters/<id>.md when you need the prose, before responding)`
        )

    // A chat skill with a bound prompt assembles that prompt on the client (filled inputs + the
    // overview + referenced terms) and ships the resolved blocks here. Materialize them into the
    // session's `artifacts/` so Codex can run_llm against the file or read it for context — the
    // mid-session equivalent of seeding a scene_operation/continuation artifact at creation time.
    const promptArtifact = body?.promptArtifact && typeof body.promptArtifact === 'object'
        ? (body.promptArtifact as Record<string, unknown>)
        : null
    const artifactSkillId = promptArtifact && typeof promptArtifact.skillId === 'string' ? promptArtifact.skillId.trim() : ''
    const artifactBlocks = promptArtifact && Array.isArray(promptArtifact.renderedBlocks)
        ? (promptArtifact.renderedBlocks as unknown[])
            .map((block) => {
                const record = block as { role?: unknown; text?: unknown }
                return typeof record?.role === 'string' && typeof record?.text === 'string'
                    ? { role: record.role, text: record.text }
                    : null
            })
            .filter((block): block is { role: string; text: string } => block !== null)
        : []
    let seededArtifactFileName: string | null = null
    if (artifactSkillId && artifactBlocks.length > 0) {
        try {
            const seeded = await seedSkillSessionArtifact({
                ownerId: user.userId,
                novelId: existing.novelId,
                sessionId: existing.id,
                skillId: artifactSkillId,
                renderedBlocks: artifactBlocks,
            })
            seededArtifactFileName = seeded?.fileName ?? null
        } catch (error) {
            console.error('Seed chat skill artifact error:', error)
        }
    }

    const finalPromptText = seededArtifactFileName
        ? `${promptText}\n\n[OpenNovelWriter] The prompt for the skill above is pre-assembled with the author's inputs (overview + referenced terms included) in artifacts/${seededArtifactFileName}. Follow the skill's instructions — call run_llm against that file, or read it for context.`
        : promptText

    const now = new Date()
    const startedAt = now.toISOString()
    const currentMessages = parseCodexSessionMessages(existing.messagesJson)
    const userMessage: CodexSessionMessage = {
        id: createCodexMessageId('codex_user'),
        role: 'user',
        content,
        attachments,
        createdAt: startedAt,
    }
    const optimisticMessages = [...currentMessages, userMessage]
    const title = existing.titleManuallyEdited ? existing.title : createCodexSessionTitle(optimisticMessages)

    await prisma.codexSession.update({
        where: { id },
        data: {
            messagesJson: JSON.stringify(optimisticMessages),
            draftContent: '',
            status: 'running',
            lastError: null,
            title,
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
        reasoningEffort: existing.reasoningEffort,
        serviceTier: existing.serviceTier,
        planMode: existing.planMode,
        prompt: finalPromptText,
        imageUrls: attachments,
        skillRefs,
    }

    if (stream) {
        const bodyStream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const send = (event: string, data: unknown) => {
                    controller.enqueue(encodeSse(event, data))
                }
                const streamedMessages = [...optimisticMessages]
                let assistantSegmentId: string | null = null
                let assistantSegmentCreatedAt: string | null = null
                let contextWindow: CodexContextWindow | null = null

                try {
                    const result = await runNovelCodexTurn({
                        ...runInput,
                        stream: {
                            onAssistantDelta: (delta) => {
                                if (!assistantSegmentId) {
                                    assistantSegmentId = createCodexMessageId('codex_assistant_stream')
                                    assistantSegmentCreatedAt = new Date().toISOString()
                                }
                                const segmentId = assistantSegmentId
                                const segmentCreatedAt = assistantSegmentCreatedAt ?? new Date().toISOString()
                                assistantSegmentCreatedAt = segmentCreatedAt
                                appendAssistantDeltaMessage(streamedMessages, delta, segmentId, segmentCreatedAt)
                                send('assistant_delta', { id: segmentId, delta, createdAt: segmentCreatedAt })
                            },
                            onPlanDelta: (event) => {
                                // Same rule as onEvent: later deltas accumulate into the existing
                                // plan message, so only the first one breaks the assistant segment.
                                const isNewEvent = !streamedMessages.some((message) => message.id === event.id)
                                if (isNewEvent) {
                                    assistantSegmentId = null
                                    assistantSegmentCreatedAt = null
                                }
                                upsertPlanDeltaMessage(streamedMessages, event)
                                send('plan_delta', event)
                            },
                            onEvent: (event) => {
                                // Only a NEW event interleaves with the assistant text and warrants
                                // starting a fresh segment. Re-emits of an existing id (command output
                                // deltas, the image-generation re-emit that adds the saved file URL)
                                // update in place — breaking the segment for them would chop the
                                // streaming reply mid-sentence into separate bubbles.
                                const isNewEvent = !streamedMessages.some((message) => message.id === event.id)
                                if (isNewEvent) {
                                    assistantSegmentId = null
                                    assistantSegmentCreatedAt = null
                                }
                                upsertEventMessage(streamedMessages, event)
                                send('event', event)
                            },
                            onApprovalRequest: (approval) => {
                                send('approval_request', { approval })
                            },
                            onContextWindow: (nextContextWindow) => {
                                contextWindow = nextContextWindow
                                send('context_window', { contextWindow: nextContextWindow })
                            },
                        },
                    })
                    contextWindow = result.contextWindow ?? contextWindow

                    const hasAssistantMessage = streamedMessages.slice(optimisticMessages.length).some((message) => message.role === 'assistant')
                    if (!hasAssistantMessage) {
                        streamedMessages.push({
                            id: createCodexMessageId('codex_assistant'),
                            role: 'assistant',
                            content: result.assistantText || 'Codex finished without a text response.',
                            createdAt: new Date().toISOString(),
                        })
                    }
                    attachContextWindowToLastAssistant(streamedMessages, contextWindow)
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
                    const message = error instanceof Error ? error.message : 'Codex run failed.'
                    const failedMessages: CodexSessionMessage[] = [
                        ...optimisticMessages,
                        {
                            id: createCodexMessageId('codex_error'),
                            role: 'event',
                            kind: 'error',
                            content: message,
                            createdAt: new Date().toISOString(),
                        },
                    ]
                    const session = await prisma.codexSession.update({
                        where: { id },
                        data: {
                            messagesJson: JSON.stringify(failedMessages),
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

    try {
        const result = await runNovelCodexTurn(runInput)

        const eventMessages = toEventMessages(result.events)
        const assistantMessage: CodexSessionMessage = {
            id: createCodexMessageId('codex_assistant'),
            role: 'assistant',
            content: result.assistantText || 'Codex finished without a text response.',
            contextWindow: result.contextWindow,
            createdAt: new Date().toISOString(),
        }
        const messages = [...optimisticMessages, ...eventMessages, assistantMessage]
        const session = await prisma.codexSession.update({
            where: { id },
            data: {
                codexThreadId: result.threadId,
                codexConnectionId: result.connectionId,
                messagesJson: JSON.stringify(messages),
                draftContent: '',
                status: 'idle',
                lastError: null,
                updatedAt: new Date(),
            },
        })

        return NextResponse.json({ session: serializeCodexSession(session) }, { status: 201 })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Codex run failed.'
        const failedMessages: CodexSessionMessage[] = [
            ...optimisticMessages,
            {
                id: createCodexMessageId('codex_error'),
                role: 'event',
                kind: 'error',
                content: message,
                createdAt: new Date().toISOString(),
            },
        ]
        const session = await prisma.codexSession.update({
            where: { id },
            data: {
                messagesJson: JSON.stringify(failedMessages),
                draftContent: '',
                status: 'error',
                lastError: message,
                updatedAt: new Date(),
            },
        })

        return NextResponse.json({ session: serializeCodexSession(session), detail: message }, { status: 500 })
    }
}
