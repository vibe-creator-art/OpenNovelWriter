import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { updateNovelCodexGoal } from '@/lib/server/codex-app-server'
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

export async function PATCH(request: NextRequest, { params }: RouteContext) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const id = await getRouteId(params)
    const existing = await prisma.codexSession.findFirst({
        where: { id, ownerId: user.userId },
    })
    if (!existing) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })
    const currentGoal = parseCodexThreadGoal(existing.goalJson)
    const codexThreadId = currentGoal?.threadId ?? existing.codexThreadId
    if (!currentGoal || !codexThreadId) {
        return NextResponse.json({ detail: 'This session has no active goal.' }, { status: 409 })
    }

    const body = await request.json().catch(() => null)
    const action = body?.action
    if (action !== 'edit' && action !== 'pause' && action !== 'clear') {
        return NextResponse.json({ detail: 'Invalid goal action.' }, { status: 400 })
    }
    const objective = action === 'edit' && typeof body?.objective === 'string' ? body.objective.trim() : ''
    if (action === 'edit' && (!objective || objective.length > 4000)) {
        return NextResponse.json({ detail: 'Goal objective must contain 1 to 4,000 characters.' }, { status: 400 })
    }

    const result = await updateNovelCodexGoal({
        sessionId: existing.id,
        ownerId: user.userId,
        codexThreadId,
        codexConnectionId: existing.codexConnectionId,
        ...(action === 'edit' ? { objective } : {}),
        ...(action === 'pause' ? { status: 'paused' as const } : {}),
        clear: action === 'clear',
        interruptTurn: action === 'pause' || action === 'clear',
    })

    const session = await prisma.codexSession.update({
        where: { id },
        data: action === 'clear'
            ? { composerMode: 'default', codexThreadId, goalJson: null, updatedAt: new Date() }
            : { codexThreadId, goalJson: JSON.stringify(result.goal), updatedAt: new Date() },
    })
    return NextResponse.json({ session: serializeCodexSession(session) })
}
