import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { updateNovelSceneEmbeddings } from '@/lib/server/hybrid-retrieval'
import { updateNovelStoryEmbeddings } from '@/lib/server/story-graph-retrieval'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const sceneId = typeof body?.sceneId === 'string' && body.sceneId.trim() ? body.sceneId.trim() : null

    try {
        const sceneResult = await updateNovelSceneEmbeddings(prisma, {
            ownerId: user.userId,
            novelId: id,
            sceneId,
            signal: request.signal,
        })
        if (sceneId) return NextResponse.json(sceneResult)
        const storyResult = await updateNovelStoryEmbeddings(prisma, {
            ownerId: user.userId,
            novelId: id,
            signal: request.signal,
        })
        return NextResponse.json({
            updated: sceneResult.updated + storyResult.updated,
            skipped: sceneResult.skipped + storyResult.skipped,
            groupId: sceneResult.groupId,
            assignmentId: storyResult.assignmentId ?? sceneResult.assignmentId,
            modelId: storyResult.modelId ?? sceneResult.modelId,
            scene: sceneResult,
            storyState: storyResult,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Embedding update failed.'
        const status = message === 'Novel not found.' || message === 'Scene not found.' ? 404 : 502
        console.error('Failed to update retrieval embeddings:', error)
        return NextResponse.json({ detail: message }, { status })
    }
}
