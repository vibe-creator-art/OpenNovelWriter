import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await context.params
    const connection = await prisma.aiConnection.findFirst({
        where: { id, ownerId: user.userId },
        select: { id: true },
    })

    if (!connection) {
        return NextResponse.json({ detail: 'Not found' }, { status: 404 })
    }

    await prisma.aiConnection.delete({ where: { id } })
    return NextResponse.json({ message: 'Deleted' })
}
