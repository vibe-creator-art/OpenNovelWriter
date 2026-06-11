import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

const normalizeName = (value: string) => value.trim().toLocaleLowerCase()

async function hasDuplicateSetName(ownerId: string, name: string, excludeId?: string) {
    const sets = await prisma.aiModelSet.findMany({
        where: {
            ownerId,
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { name: true },
    })

    const normalizedName = normalizeName(name)
    return sets.some((set) => normalizeName(set.name) === normalizedName)
}

export async function GET(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const sets = await prisma.aiModelSet.findMany({
        where: { ownerId: user.userId },
        orderBy: { sortOrder: 'asc' },
        include: {
            members: {
                orderBy: { sortOrder: 'asc' },
            },
        },
    })

    return NextResponse.json({
        sets: sets.map((set) => ({
            id: set.id,
            name: set.name,
            fixed: false,
            members: set.members.map((member) => ({
                id: member.id,
                groupId: member.groupId,
            })),
        })),
    })
}

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const name = String(body?.name || '').trim()
        if (!name) {
            return NextResponse.json({ detail: 'Missing name.' }, { status: 400 })
        }

        if (await hasDuplicateSetName(user.userId, name)) {
            return NextResponse.json({ detail: 'Set name already exists.' }, { status: 409 })
        }

        const maxOrder = await prisma.aiModelSet.aggregate({
            where: { ownerId: user.userId },
            _max: { sortOrder: true },
        })

        const sortOrder = (maxOrder._max.sortOrder ?? 0) + 1

        const set = await prisma.aiModelSet.create({
            data: {
                ownerId: user.userId,
                name,
                sortOrder,
            },
        })

        return NextResponse.json({
            set: {
                id: set.id,
                name: set.name,
                fixed: false,
                members: [],
            },
        })
    } catch (error) {
        console.error('Failed to create model set:', error)
        const message = error instanceof Error ? error.message : 'Failed to create model set.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to create model set.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
