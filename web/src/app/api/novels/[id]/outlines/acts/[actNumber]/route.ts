import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface RouteParams {
    params: Promise<{ id: string; actNumber: string }>
}

// DELETE /api/novels/[id]/outlines/acts/[actNumber] - Delete an act outline
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId, actNumber: actNumberStr } = await params
        const actNumber = parseInt(actNumberStr, 10)

        if (!Number.isFinite(actNumber) || !Number.isInteger(actNumber) || actNumber <= 0) {
            return NextResponse.json({ detail: 'Invalid act number' }, { status: 400 })
        }

        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        await prisma.outline.deleteMany({
            where: { novelId, type: 'ACT', actNumber },
        })

        return NextResponse.json({ message: 'Outline deleted successfully' })
    } catch (error) {
        console.error('Delete act outline error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

