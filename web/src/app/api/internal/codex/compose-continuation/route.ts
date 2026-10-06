import { ZodError } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { parseContinuationInputs } from '@/lib/continuation-inputs'
import { composeSceneContinuation } from '@/lib/server/continuation-compose'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

/** Renders a scene-continuation prompt for the Codex MCP tool using the shared internal token. */
export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    const promptName = typeof body?.promptName === 'string' ? body.promptName.trim() : ''
    const novelId = typeof body?.novelId === 'string' ? body.novelId.trim() : ''
    const sceneId = typeof body?.sceneId === 'string' ? body.sceneId.trim() : ''
    const instruction = typeof body?.instruction === 'string' ? body.instruction : ''
    const afterParagraph = typeof body?.afterParagraph === 'string' ? body.afterParagraph : ''

    if (!ownerId) return NextResponse.json({ detail: 'ownerId is required.' }, { status: 400 })
    if (!promptName) return NextResponse.json({ detail: 'promptName is required.' }, { status: 400 })
    if (!novelId) return NextResponse.json({ detail: 'novelId is required.' }, { status: 400 })
    if (!sceneId) return NextResponse.json({ detail: 'sceneId is required.' }, { status: 400 })

    try {
        const result = await composeSceneContinuation({
            ownerId,
            promptName,
            novelId,
            sceneId,
            instruction,
            inputs: parseContinuationInputs(body?.inputs),
            afterParagraph,
        })
        if (!result.ok) {
            return NextResponse.json({ detail: result.detail }, { status: 400 })
        }
        return NextResponse.json({
            ok: true,
            markdown: result.result.markdown,
            promptName: result.result.promptName,
            groups: result.result.groups,
            missingInputs: result.result.missingInputs,
        })
    } catch (error) {
        console.error('Codex compose-continuation internal call failed:', error)
        return NextResponse.json(
            { detail: error instanceof Error ? error.message : 'Failed to compose continuation prompt.' },
            { status: error instanceof ZodError ? 400 : 500 }
        )
    }
}
