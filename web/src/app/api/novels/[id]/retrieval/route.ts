import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { listRetrievalModelGroups } from '@/lib/server/retrieval-models'

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const { id } = await params
    const novel = await prisma.novel.findFirst({
        where: { id, ownerId: user.userId },
        select: { id: true },
    })
    if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

    const [embeddingGroups, rerankerGroups] = await Promise.all([
        listRetrievalModelGroups(prisma, user.userId, 'embedding'),
        listRetrievalModelGroups(prisma, user.userId, 'reranker'),
    ])
    return NextResponse.json({ embeddingGroups, rerankerGroups })
}
