import { NextRequest, NextResponse } from 'next/server'
import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { describePromptForAgent } from '@/lib/server/continuation-compose'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

/**
 * Internal callback for the Codex MCP `describe_prompt` tool. Returns the input schema (typed by
 * custom / checkbox / content_selection) and bound model groups of a Codex-callable prompt, so the
 * model knows what to pass to `compose_scene_continuation`. Auth is the shared internal token.
 */
export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    const promptName = typeof body?.promptName === 'string' ? body.promptName.trim() : ''

    if (!ownerId) return NextResponse.json({ detail: 'ownerId is required.' }, { status: 400 })
    if (!promptName) return NextResponse.json({ detail: 'promptName is required.' }, { status: 400 })

    try {
        const result = await describePromptForAgent({ ownerId, promptName })
        if (!result.ok) {
            return NextResponse.json({ detail: result.detail }, { status: 404 })
        }
        return NextResponse.json({ ok: true, prompt: result.prompt })
    } catch (error) {
        console.error('Codex describe-prompt internal call failed:', error)
        return NextResponse.json(
            { detail: error instanceof Error ? error.message : 'Failed to describe prompt.' },
            { status: 500 }
        )
    }
}
