import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

type IncomingMember = {
    groupId: string
}

function parseMembers(body: unknown): IncomingMember[] | null {
    if (!body || typeof body !== 'object') return null
    const value = (body as { members?: unknown }).members
    if (!Array.isArray(value)) return null
    return value as IncomingMember[]
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id: setId } = await context.params

    try {
        const body = await request.json()
        const members = parseMembers(body)
        if (!members) {
            return NextResponse.json({ detail: 'Missing members.' }, { status: 400 })
        }

        const set = await prisma.aiModelSet.findFirst({
            where: { id: setId, ownerId: user.userId },
            select: { id: true },
        })
        if (!set) {
            return NextResponse.json({ detail: 'Not found' }, { status: 404 })
        }

        const groupIds = members.map((item) => String(item?.groupId || '').trim())
        if (groupIds.some((id) => !id)) {
            return NextResponse.json({ detail: 'Invalid groupId in members.' }, { status: 400 })
        }

        const uniqueGroupIds = Array.from(new Set(groupIds))
        if (uniqueGroupIds.length !== groupIds.length) {
            return NextResponse.json({ detail: 'Duplicate groupId in members.' }, { status: 400 })
        }

        if (uniqueGroupIds.length > 0) {
            const validGroups = await prisma.aiModelGroup.findMany({
                where: { ownerId: user.userId, id: { in: uniqueGroupIds } },
                select: { id: true },
            })
            const validSet = new Set(validGroups.map((group) => group.id))
            if (uniqueGroupIds.some((gid) => !validSet.has(gid))) {
                return NextResponse.json({ detail: 'Invalid groupId in members.' }, { status: 400 })
            }
        }

        await prisma.$transaction(async (tx) => {
            if (uniqueGroupIds.length === 0) {
                await tx.aiModelSetMember.deleteMany({
                    where: { ownerId: user.userId, setId },
                })
                return
            }

            await tx.aiModelSetMember.deleteMany({
                where: { ownerId: user.userId, setId, groupId: { notIn: uniqueGroupIds } },
            })

            for (const [index, groupId] of uniqueGroupIds.entries()) {
                await tx.aiModelSetMember.upsert({
                    where: { setId_groupId: { setId, groupId } },
                    update: {
                        ownerId: user.userId,
                        sortOrder: index,
                    },
                    create: {
                        ownerId: user.userId,
                        setId,
                        groupId,
                        sortOrder: index,
                    },
                })
            }
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Failed to set members:', error)
        const message = error instanceof Error ? error.message : 'Failed to set members.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to set members.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
