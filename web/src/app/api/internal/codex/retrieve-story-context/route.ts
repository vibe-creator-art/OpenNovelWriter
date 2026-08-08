import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { normalizeRetrievalTopK, searchNovelScenes } from '@/lib/server/hybrid-retrieval'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'

export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
    const novelId = typeof body?.novelId === 'string' ? body.novelId.trim() : ''
    const query = typeof body?.query === 'string' ? body.query.trim() : ''
    const topK = body?.topK === undefined ? undefined : normalizeRetrievalTopK(body.topK)
    if (!ownerId || !novelId || !query) {
        return NextResponse.json({ detail: 'ownerId, novelId, and query are required.' }, { status: 400 })
    }

    try {
        const result = await searchNovelScenes(prisma, {
            ownerId,
            novelId,
            query,
            topK,
            signal: request.signal,
        })
        return NextResponse.json({ ok: true, ...result })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Retrieval failed.'
        const status = message === 'Novel not found.' ? 404 : 502
        console.error('Codex story retrieval failed:', error)
        return NextResponse.json({ detail: message }, { status })
    }
}
