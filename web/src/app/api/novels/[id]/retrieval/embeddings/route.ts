import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { updateNovelSceneEmbeddings } from '@/lib/server/hybrid-retrieval'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const sceneId = typeof body?.sceneId === 'string' && body.sceneId.trim() ? body.sceneId.trim() : null

    try {
        return NextResponse.json(await updateNovelSceneEmbeddings(prisma, {
            ownerId: user.userId,
            novelId: id,
            sceneId,
            signal: request.signal,
        }))
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Embedding update failed.'
        const status = message === 'Novel not found.' || message === 'Scene not found.' ? 404 : 502
        console.error('Failed to update retrieval embeddings:', error)
        return NextResponse.json({ detail: message }, { status })
    }
}
