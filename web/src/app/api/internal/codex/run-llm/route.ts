import { NextRequest, NextResponse } from 'next/server'
import type { ModelMessage } from 'ai'
import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import {
    loadModelGroupForOwner,
    ModelGroupRunnerError,
    runModelGroupWithFallbackOnServer,
} from '@/lib/server/model-group-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

/**
 * Internal callback used by the Codex MCP subprocess (run_llm tool) to invoke an
 * external model group. The MCP runs as a separate local process and cannot import
 * the model-group runner, so it posts here authenticated with the shared internal
 * token. Not reachable by the browser session — auth is the token, not a cookie.
 */
export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    const groupId = typeof body?.groupId === 'string' ? body.groupId.trim() : ''
    const system = typeof body?.system === 'string' && body.system.trim() ? body.system : undefined
    const rawMessages = Array.isArray(body?.messages) ? body.messages : []
    const temperature =
        typeof body?.temperature === 'number' && Number.isFinite(body.temperature) ? body.temperature : undefined
    const maxTokens =
        typeof body?.maxTokens === 'number' && Number.isFinite(body.maxTokens) ? body.maxTokens : undefined

    if (!ownerId) return NextResponse.json({ detail: 'ownerId is required.' }, { status: 400 })
    if (!groupId) return NextResponse.json({ detail: 'groupId is required.' }, { status: 400 })

    const messages = rawMessages
        .filter(
            (message: unknown): message is { role: string; content: string } =>
                Boolean(message) &&
                typeof message === 'object' &&
                typeof (message as { content?: unknown }).content === 'string' &&
                ((message as { role?: unknown }).role === 'user' ||
                    (message as { role?: unknown }).role === 'assistant')
        )
        .map((message: { role: string; content: string }) => ({
            role: message.role as 'user' | 'assistant',
            content: message.content,
        }))

    if (messages.length === 0) {
        return NextResponse.json({ detail: 'At least one user/assistant message is required.' }, { status: 400 })
    }

    const group = await loadModelGroupForOwner({ ownerId, groupId })
    if (!group) {
        return NextResponse.json({ detail: 'Model group not found.' }, { status: 404 })
    }

    try {
        const result = await runModelGroupWithFallbackOnServer({
            group,
            signal: request.signal,
            input: {
                stream: false,
                system,
                temperature,
                maxTokens,
                messages: messages as ModelMessage[],
            },
        })

        return NextResponse.json({
            ok: true,
            text: result.text,
            reasoningText: result.reasoningText,
            usage: result.usage,
            groupName: group.name,
            modelId: result.usedAssignment.modelId,
        })
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return NextResponse.json({ detail: 'Aborted.' }, { status: 499 })
        }
        console.error('Codex run-llm internal call failed:', error)
        return NextResponse.json(
            {
                detail: error instanceof Error ? error.message : 'Failed to run model group.',
                code: error instanceof ModelGroupRunnerError ? error.code : 'MODEL_GROUP_RUN_FAILED',
            },
            { status: 502 }
        )
    }
}
