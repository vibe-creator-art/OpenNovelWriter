import { NextRequest, NextResponse } from 'next/server'

import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { buildPromptLibraryExport } from '@/lib/server/prompt-authoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    if (!ownerId) return NextResponse.json({ detail: 'ownerId is required.' }, { status: 400 })

    try {
        return NextResponse.json({ ok: true, library: await buildPromptLibraryExport(ownerId) })
    } catch (error) {
        console.error('Codex prompt-library internal call failed:', error)
        return NextResponse.json(
            { detail: error instanceof Error ? error.message : 'Failed to export prompt library.' },
            { status: 500 }
        )
    }
}
