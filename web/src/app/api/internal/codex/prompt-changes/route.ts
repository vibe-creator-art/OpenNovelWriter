import { NextRequest, NextResponse } from 'next/server'

import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { processPromptChangeSet } from '@/lib/server/prompt-authoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    const mode = body?.mode === 'apply' ? 'apply' : body?.mode === 'validate' ? 'validate' : null
    if (!ownerId) return NextResponse.json({ detail: 'ownerId is required.' }, { status: 400 })
    if (!mode) return NextResponse.json({ detail: 'mode must be validate or apply.' }, { status: 400 })

    try {
        const result = await processPromptChangeSet({ ownerId, mode, changeSet: body?.changeSet })
        return NextResponse.json(result, { status: result.ok ? 200 : result.status })
    } catch (error) {
        console.error('Codex prompt-changes internal call failed:', error)
        return NextResponse.json(
            { detail: error instanceof Error ? error.message : 'Failed to process prompt changes.' },
            { status: 500 }
        )
    }
}
