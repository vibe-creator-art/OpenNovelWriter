import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { interruptAndWaitForActiveCodexRun, updateNovelCodexGoal } from '@/lib/server/codex-app-server'
import { parseCodexThreadGoal, serializeCodexSession } from '@/lib/server/codex-session'

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
        })
        if (!existing) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })
        const currentGoal = parseCodexThreadGoal(existing.goalJson)
        const codexThreadId = currentGoal?.threadId ?? existing.codexThreadId
        let session = existing
        if (currentGoal?.status === 'active' && codexThreadId) {
            const result = await updateNovelCodexGoal({
                sessionId: existing.id,
                ownerId: user.userId,
                codexThreadId,
                codexConnectionId: existing.codexConnectionId,
                status: 'paused',
            })
            session = await prisma.codexSession.update({
                where: { id },
                data: { goalJson: JSON.stringify(result.goal), updatedAt: new Date() },
            })
        }
        const interrupted = await interruptAndWaitForActiveCodexRun(id)
        if (!interrupted && session.status !== 'running') {
            return NextResponse.json({ ok: true, session: serializeCodexSession(session) })
        }

        session = await prisma.codexSession.update({
            where: { id },
            data: {
                status: 'idle',
                lastError: null,
                unreadCompletionAt: null,
                updatedAt: new Date(),
            },
        })
        return NextResponse.json({ ok: true, session: serializeCodexSession(session) })
    } catch (error) {
        console.error('Stop Codex turn error:', error)
        return NextResponse.json({ detail: error instanceof Error ? error.message : 'Internal server error' }, { status: 409 })
    }
}
