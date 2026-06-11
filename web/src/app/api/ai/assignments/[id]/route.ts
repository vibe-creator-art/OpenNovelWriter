import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await context.params

    try {
        const body = await request.json()

        const assignment = await prisma.aiModelAssignment.findFirst({
            where: { id, ownerId: user.userId },
            select: { id: true },
        })
        if (!assignment) {
            return NextResponse.json({ detail: 'Not found' }, { status: 404 })
        }

        const ignoredUntil = body?.ignoredUntil ? new Date(body.ignoredUntil) : null
        const ignoredUntilValue =
            ignoredUntil && !Number.isNaN(ignoredUntil.getTime()) ? ignoredUntil : null

        await prisma.aiModelAssignment.update({
            where: { id },
            data: {
                ...(typeof body?.failureCount === 'number' ? { failureCount: body.failureCount } : null),
                ...(body?.ignoredUntil !== undefined ? { ignoredUntil: ignoredUntilValue } : null),
                ...(typeof body?.manuallyDisabled === 'boolean'
                    ? { manuallyDisabled: body.manuallyDisabled }
                    : null),
            },
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Failed to update assignment:', error)
        const message = error instanceof Error ? error.message : 'Failed to update assignment.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to update assignment.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
