import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { syncNovelWorkspaceOutline } from '@/lib/server/novel-workspace'

interface RouteParams {
    params: Promise<{ id: string }>
}

interface ReorderItem {
    id: string
    order: number
    actNumber?: number
}

// PATCH /api/novels/[id]/chapters/reorder - Batch reorder chapters
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params
        const body = await request.json()
        const { updates } = body as { updates: ReorderItem[] }

        if (!updates || !Array.isArray(updates)) {
            return NextResponse.json(
                { detail: 'Invalid request: updates array required' },
                { status: 400 }
            )
        }

        // Verify novel ownership
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        // Perform batch update in a transaction
        await prisma.$transaction(
            updates.map((item) =>
                prisma.chapter.update({
                    where: { id: item.id },
                    data: {
                        order: item.order,
                        ...(item.actNumber !== undefined && { actNumber: item.actNumber }),
                    },
                })
            )
        )

        // Return updated chapters
        const chapters = await prisma.chapter.findMany({
            where: { novelId },
            orderBy: [{ actNumber: 'asc' }, { order: 'asc' }],
        })
        await syncNovelWorkspaceOutline(user.userId, novelId)

        return NextResponse.json(chapters)
    } catch (error) {
        console.error('Reorder chapters error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
