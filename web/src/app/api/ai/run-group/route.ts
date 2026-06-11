import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
    loadModelGroupForOwner,
    ModelGroupRunnerError,
    runModelGroupWithFallbackOnServer,
    type RunModelMessage,
} from '@/lib/server/model-group-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const groupId = typeof body?.groupId === 'string' ? body.groupId.trim() : ''
    const preferredAssignmentId =
        typeof body?.preferredAssignmentId === 'string' ? body.preferredAssignmentId.trim() : undefined
    const messages = (body?.messages ?? null) as RunModelMessage[] | null
    const prompt = typeof body?.prompt === 'string' ? body.prompt : null

    if (!groupId) {
        return NextResponse.json({ detail: 'groupId is required.' }, { status: 400 })
    }

    if ((!messages || messages.length === 0) && !prompt) {
        return NextResponse.json({ detail: 'Missing messages or prompt.' }, { status: 400 })
    }

    const group = await loadModelGroupForOwner({ ownerId: user.userId, groupId })
    if (!group) {
        return NextResponse.json({ detail: 'Model group not found.' }, { status: 404 })
    }

    const encoder = new TextEncoder()
    const writeEvent = (controller: ReadableStreamDefaultController<Uint8Array>, event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
    }

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            void (async () => {
                try {
                    const result = await runModelGroupWithFallbackOnServer({
                        group,
                        preferredAssignmentId,
                        signal: request.signal,
                        input: {
                            stream: true,
                            temperature:
                                typeof body?.temperature === 'number' && Number.isFinite(body.temperature)
                                    ? body.temperature
                                    : undefined,
                            maxTokens:
                                typeof body?.maxTokens === 'number' && Number.isFinite(body.maxTokens)
                                    ? body.maxTokens
                                    : undefined,
                            system: typeof body?.system === 'string' ? body.system : undefined,
                            messages: messages && messages.length > 0 ? messages : undefined,
                            prompt: prompt ?? undefined,
                        },
                        onTextDelta: (delta) => {
                            writeEvent(controller, { type: 'text_delta', delta })
                        },
                        onReasoningDelta: (delta) => {
                            writeEvent(controller, { type: 'reasoning_delta', delta })
                        },
                    })

                    writeEvent(controller, {
                        type: 'end',
                        text: result.text,
                        reasoningText: result.reasoningText,
                        usage: result.usage,
                        usedAssignment: result.usedAssignment,
                    })
                } catch (error) {
                    if (!(error instanceof DOMException && error.name === 'AbortError')) {
                        console.error('AI model group run failed:', error)
                        writeEvent(controller, {
                            type: 'error',
                            error: {
                                code: error instanceof ModelGroupRunnerError ? error.code : 'MODEL_GROUP_RUN_FAILED',
                                message: error instanceof Error ? error.message : 'Failed to run model group.',
                            },
                        })
                    }
                } finally {
                    controller.close()
                }
            })()
        },
        cancel() {
            request.signal.throwIfAborted?.()
        },
    })

    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    })
}
