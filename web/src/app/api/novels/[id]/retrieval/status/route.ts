import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getNovelRetrievalStatus } from '@/lib/server/hybrid-retrieval'

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id } = await params

    try {
        return NextResponse.json(await getNovelRetrievalStatus(prisma, {
            ownerId: user.userId,
            novelId: id,
        }))
    } catch (error) {
        if (error instanceof Error && error.message === 'Novel not found.') {
            return NextResponse.json({ detail: error.message }, { status: 404 })
        }
        console.error('Failed to load retrieval status:', error)
        return NextResponse.json({ detail: 'Failed to load retrieval status.' }, { status: 500 })
    }
}
