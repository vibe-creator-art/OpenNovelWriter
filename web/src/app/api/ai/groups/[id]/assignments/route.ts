import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

type IncomingAssignment = {
    id: string
    connectionId: string
    modelId: string
    failureCount?: number
    ignoredUntil?: string | null
    manuallyDisabled?: boolean
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id: groupId } = await context.params

    try {
        const body = await request.json()
        const assignments = Array.isArray(body?.assignments) ? (body.assignments as IncomingAssignment[]) : null
        if (!assignments) {
            return NextResponse.json({ detail: 'Missing assignments.' }, { status: 400 })
        }

        const group = await prisma.aiModelGroup.findFirst({
            where: { id: groupId, ownerId: user.userId },
            select: { id: true },
        })
        if (!group) {
            return NextResponse.json({ detail: 'Not found' }, { status: 404 })
        }

        const connectionIds = Array.from(
            new Set(assignments.map((item) => String(item?.connectionId || '').trim()).filter(Boolean))
        )
        const validConnections = await prisma.aiConnection.findMany({
            where: { ownerId: user.userId, id: { in: connectionIds } },
            select: { id: true },
        })
        const validConnectionSet = new Set(validConnections.map((c) => c.id))
        if (connectionIds.some((cid) => !validConnectionSet.has(cid))) {
            return NextResponse.json({ detail: 'Invalid connectionId in assignments.' }, { status: 400 })
        }

        const ids = new Set(assignments.map((item) => String(item?.id || '').trim()).filter(Boolean))
        if (ids.size !== assignments.length) {
            return NextResponse.json({ detail: 'Invalid assignment id.' }, { status: 400 })
        }

        const existing = await prisma.aiModelAssignment.findMany({
            where: { id: { in: Array.from(ids) } },
            select: { id: true, ownerId: true },
        })
        const foreign = existing.find((item) => item.ownerId !== user.userId)
        if (foreign) {
            return NextResponse.json({ detail: 'Forbidden assignment id.' }, { status: 403 })
        }

        await prisma.$transaction(async (tx) => {
            await tx.aiModelAssignment.deleteMany({
                where: { ownerId: user.userId, groupId, id: { notIn: Array.from(ids) } },
            })

            for (const [index, assignment] of assignments.entries()) {
                const assignmentId = String(assignment.id).trim()
                const connectionId = String(assignment.connectionId).trim()
                const modelId = String(assignment.modelId).trim()
                if (!assignmentId || !connectionId || !modelId) continue

                const ignoredUntil = assignment.ignoredUntil ? new Date(assignment.ignoredUntil) : null
                const ignoredUntilValue =
                    ignoredUntil && !Number.isNaN(ignoredUntil.getTime()) ? ignoredUntil : null

                await tx.aiModelAssignment.upsert({
                    where: { id: assignmentId },
                    update: {
                        ownerId: user.userId,
                        groupId,
                        connectionId,
                        modelId,
                        sortOrder: index,
                        failureCount: Number(assignment.failureCount || 0),
                        ignoredUntil: ignoredUntilValue,
                        manuallyDisabled: Boolean(assignment.manuallyDisabled),
                    },
                    create: {
                        id: assignmentId,
                        ownerId: user.userId,
                        groupId,
                        connectionId,
                        modelId,
                        sortOrder: index,
                        failureCount: Number(assignment.failureCount || 0),
                        ignoredUntil: ignoredUntilValue,
                        manuallyDisabled: Boolean(assignment.manuallyDisabled),
                    },
                })
            }
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Failed to set assignments:', error)
        const message = error instanceof Error ? error.message : 'Failed to set assignments.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to set assignments.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
