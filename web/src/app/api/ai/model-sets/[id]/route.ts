import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

const normalizeName = (value: string) => value.trim().toLocaleLowerCase()

async function hasDuplicateSetName(ownerId: string, name: string, excludeId: string) {
    const sets = await prisma.aiModelSet.findMany({
        where: {
            ownerId,
            id: { not: excludeId },
        },
        select: { name: true },
    })

    const normalizedName = normalizeName(name)
    return sets.some((set) => normalizeName(set.name) === normalizedName)
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await context.params

    try {
        const body = await request.json()
        const hasNameField = typeof body?.name === 'string'
        const name = hasNameField ? body.name.trim() : undefined
        if (hasNameField && !name) {
            return NextResponse.json({ detail: 'Missing name.' }, { status: 400 })
        }

        const set = await prisma.aiModelSet.findFirst({
            where: { id, ownerId: user.userId },
            select: { id: true },
        })

        if (!set) {
            return NextResponse.json({ detail: 'Not found' }, { status: 404 })
        }

        if (name && (await hasDuplicateSetName(user.userId, name, id))) {
            return NextResponse.json({ detail: 'Set name already exists.' }, { status: 409 })
        }

        const updated = await prisma.aiModelSet.update({
            where: { id },
            data: {
                ...(name ? { name } : {}),
            },
        })

        return NextResponse.json({ id: updated.id })
    } catch (error) {
        console.error('Failed to update model set:', error)
        const message = error instanceof Error ? error.message : 'Failed to update model set.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to update model set.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await context.params

    const set = await prisma.aiModelSet.findFirst({
        where: { id, ownerId: user.userId },
        select: { id: true },
    })

    if (!set) {
        return NextResponse.json({ detail: 'Not found' }, { status: 404 })
    }

    await prisma.aiModelSet.delete({ where: { id } })
    return NextResponse.json({ message: 'Deleted' })
}
