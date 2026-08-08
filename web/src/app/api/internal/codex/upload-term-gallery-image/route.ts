import { NextRequest, NextResponse } from 'next/server'

import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { appendCodexArtifactToTermGallery, TermGalleryError } from '@/lib/server/term-gallery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
    const novelId = typeof body?.novelId === 'string' ? body.novelId.trim() : ''
    const termId = typeof body?.termId === 'string' ? body.termId.trim() : ''
    const imagePath = typeof body?.imagePath === 'string' ? body.imagePath.trim() : ''
    if (!ownerId || !sessionId || !novelId || !termId || !imagePath) {
        return NextResponse.json(
            { detail: 'ownerId, sessionId, novelId, termId, and imagePath are required.' },
            { status: 400 }
        )
    }

    try {
        const result = await appendCodexArtifactToTermGallery({ ownerId, sessionId, novelId, termId, imagePath })
        return NextResponse.json({
            ok: true,
            termId,
            ...result,
        })
    } catch (error) {
        if (error instanceof TermGalleryError) {
            return NextResponse.json({ detail: error.message }, { status: error.status })
        }
        console.error('Codex term gallery upload failed:', error)
        return NextResponse.json({ detail: 'Failed to upload image to term gallery.' }, { status: 500 })
    }
}
