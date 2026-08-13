import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { normalizeRetrievalTopK, searchNovelScenes } from '@/lib/server/hybrid-retrieval'
import { searchNovelStoryGraph } from '@/lib/server/story-graph-retrieval'

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
    const includeKnowledgeGraph = body?.includeKnowledgeGraph === true
    const targetMomentId = typeof body?.targetMomentId === 'string' && body.targetMomentId.trim()
        ? body.targetMomentId.trim()
        : null
    const afterMomentId = typeof body?.afterMomentId === 'string' && body.afterMomentId.trim()
        ? body.afterMomentId.trim()
        : null
    const includeHistory = body?.includeHistory === true
    if (!ownerId || !novelId || !query) {
        return NextResponse.json({ detail: 'ownerId, novelId, and query are required.' }, { status: 400 })
    }

    try {
        const [sceneResult, storyStateResult] = await Promise.all([
            searchNovelScenes(prisma, {
                ownerId,
                novelId,
                query,
                topK,
                signal: request.signal,
            }),
            includeKnowledgeGraph
                ? searchNovelStoryGraph(prisma, {
                      ownerId,
                      novelId,
                      query,
                      topK,
                      targetMomentId,
                      afterMomentId,
                      includeHistory,
                      signal: request.signal,
                  })
                : null,
        ])
        return NextResponse.json({
            ok: true,
            ...sceneResult,
            includeKnowledgeGraph,
            storyStateModes: storyStateResult?.modes ?? null,
            storyStateFilters: storyStateResult?.filters ?? null,
            storyStateResults: storyStateResult?.results ?? [],
            warnings: [...sceneResult.warnings, ...(storyStateResult?.warnings ?? [])],
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Retrieval failed.'
        const status = message === 'Novel not found.' ? 404 : 502
        console.error('Codex story retrieval failed:', error)
        return NextResponse.json({ detail: message }, { status })
    }
}
