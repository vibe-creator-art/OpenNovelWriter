import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface RouteParams {
    params: Promise<{ id: string }>
}

// GET /api/materials/[id] - Get a single material with full content
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        const material = await prisma.material.findUnique({
            where: { id },
            include: { novel: { select: { ownerId: true } } },
        })

        if (!material || material.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Material not found' }, { status: 404 })
        }

        return NextResponse.json({
            id: material.id,
            name: material.name,
            content: material.content,
            readPosition: material.readPosition,
            order: material.order,
            novelId: material.novelId,
            createdAt: material.createdAt,
            updatedAt: material.updatedAt,
        })
    } catch (error) {
        console.error('Get material error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// PATCH /api/materials/[id] - Rename or update read position
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json().catch(() => ({}))

        const existing = await prisma.material.findUnique({
            where: { id },
            include: { novel: { select: { ownerId: true } } },
        })

        if (!existing || existing.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Material not found' }, { status: 404 })
        }

        const data: { name?: string; readPosition?: number } = {}
        if (body && typeof body === 'object') {
            if (typeof body.name === 'string') data.name = body.name
            if (typeof body.readPosition === 'number' && Number.isFinite(body.readPosition)) {
                data.readPosition = Math.min(1, Math.max(0, body.readPosition))
            }
        }

        const material = await prisma.material.update({
            where: { id },
            data,
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

        return NextResponse.json(material)
    } catch (error) {
        console.error('Update material error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/materials/[id] - Delete a material
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        const existing = await prisma.material.findUnique({
            where: { id },
            include: { novel: { select: { ownerId: true } } },
        })

        if (!existing || existing.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Material not found' }, { status: 404 })
        }

        await prisma.material.delete({ where: { id } })

        return NextResponse.json({ message: 'Material deleted successfully' })
    } catch (error) {
        console.error('Delete material error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
