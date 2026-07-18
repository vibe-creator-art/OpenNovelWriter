import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'

interface RouteContext {
    params: Promise<unknown>
}

const prisma = getPrismaClient({ ensureModel: 'codexSession' })

async function getRouteId(params: Promise<unknown>) {
    const resolved = await params
    return typeof resolved === 'object' && resolved !== null && typeof (resolved as { id?: unknown }).id === 'string'
        ? (resolved as { id: string }).id
        : ''
}

export async function POST(request: NextRequest, { params }: RouteContext) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const id = await getRouteId(params)
        const body = await request.json().catch(() => null)
        const completedAt = typeof body?.completedAt === 'string' ? new Date(body.completedAt) : null
        if (!completedAt || Number.isNaN(completedAt.getTime())) {
            return NextResponse.json({ detail: 'Invalid completion time' }, { status: 400 })
        }

        const existing = await prisma.codexSession.findFirst({
            where: { id, ownerId: user.userId },
            select: { id: true, unreadCompletionAt: true, updatedAt: true },
        })
        if (!existing) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })
        if (existing.unreadCompletionAt?.getTime() !== completedAt.getTime()) {
            return NextResponse.json({ ok: true })
        }

        await prisma.codexSession.updateMany({
            where: { id, ownerId: user.userId, unreadCompletionAt: completedAt },
            data: {
                unreadCompletionAt: null,
                // Reading a completion must not reorder the session or change its activity time.
                updatedAt: existing.updatedAt,
            },
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Mark Codex completion read error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
