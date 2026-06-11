import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { syncNovelWorkspaceOutline } from '@/lib/server/novel-workspace'

interface RouteParams {
    params: Promise<{ id: string; actNumber: string }>
}

// DELETE /api/novels/[id]/acts/[actNumber] - Delete an act
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId, actNumber: actNumberStr } = await params
        const actNumber = parseInt(actNumberStr, 10)

        if (isNaN(actNumber)) {
            return NextResponse.json({ detail: 'Invalid act number' }, { status: 400 })
        }

        // Check ownership
        const novel = await prisma.novel.findUnique({
            where: { id: novelId },
            select: { ownerId: true },
        })

        if (!novel || novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        // Delete the act
        await prisma.act.delete({
            where: {
                novelId_number: {
                    novelId,
                    number: actNumber,
                },
            },
        })
        await syncNovelWorkspaceOutline(user.userId, novelId)

        return NextResponse.json({ message: 'Act deleted successfully' })
    } catch (error) {
        console.error('Delete act error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
