import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface RouteParams {
    params: Promise<{ id: string }>
}

// GET /api/novels/[id]/labels - List labels for a novel
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

        const labels = await prisma.label.findMany({
            where: { novelId },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        })

        return NextResponse.json(labels)
    } catch (error) {
        console.error('List labels error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/novels/[id]/labels - Create a label for a novel
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

        const body = await request.json().catch(() => null)
        const nameRaw = body?.name
        if (typeof nameRaw !== 'string') {
            return NextResponse.json({ detail: 'Label name is required' }, { status: 400 })
        }
        const name = nameRaw.trim()
        if (!name) {
            return NextResponse.json({ detail: 'Label name is required' }, { status: 400 })
        }

        const lastLabel = await prisma.label.findFirst({
            where: { novelId },
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true },
        })
        const sortOrder = (lastLabel?.sortOrder ?? -1) + 1

        const label = await prisma.label.create({
            data: { novelId, name, sortOrder },
        })

        return NextResponse.json(label, { status: 201 })
    } catch (error) {
        // Unique constraint violation (duplicate label name)
        if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002') {
            return NextResponse.json({ detail: 'Label name already exists' }, { status: 409 })
        }

        console.error('Create label error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

