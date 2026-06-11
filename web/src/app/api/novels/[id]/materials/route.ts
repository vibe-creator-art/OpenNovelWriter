import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface RouteParams {
    params: Promise<{ id: string }>
}

// GET /api/novels/[id]/materials - List materials for a novel (metadata only, no content)
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params

        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const materials = await prisma.material.findMany({
            where: { novelId },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            select: {
                id: true,
                name: true,
                readPosition: true,
                order: true,
                novelId: true,
                createdAt: true,
                updatedAt: true,
            },
        })

        return NextResponse.json(materials)
    } catch (error) {
        console.error('List materials error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/novels/[id]/materials - Create a material in a novel
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params

        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => ({}))
        const name = typeof body?.name === 'string' ? body.name : ''
        const content = typeof body?.content === 'string' ? body.content : ''

        const last = await prisma.material.findFirst({
            where: { novelId },
            orderBy: { order: 'desc' },
            select: { order: true },
        })
        const order = (last?.order ?? -1) + 1

        const material = await prisma.material.create({
            data: { novelId, name, content, order },
        })

        return NextResponse.json(material, { status: 201 })
    } catch (error) {
        console.error('Create material error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
