import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { interruptActiveCodexRun } from '@/lib/server/codex-app-server'

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
        const existing = await prisma.codexSession.findFirst({
            where: { id, ownerId: user.userId },
            select: { id: true, status: true },
        })
        if (!existing) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })
        if (existing.status !== 'running') {
            return NextResponse.json({ ok: true })
        }

        await interruptActiveCodexRun(id)
        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Stop Codex turn error:', error)
        return NextResponse.json({ detail: error instanceof Error ? error.message : 'Internal server error' }, { status: 409 })
    }
}
