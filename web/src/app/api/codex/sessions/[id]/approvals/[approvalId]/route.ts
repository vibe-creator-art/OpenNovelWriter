import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import {
    resolveCodexApprovalRequest,
    type CodexApprovalOption,
} from '@/lib/server/codex-approval-bridge'
import { normalizeCodexString } from '@/lib/server/codex-session'

interface RouteContext {
    params: Promise<unknown>
}

const prisma = getPrismaClient({ ensureModel: 'codexSession' })
const APPROVAL_DECISIONS = new Set<CodexApprovalOption>([
    'accept',
    'acceptForSession',
    'acceptWithPolicy',
    'decline',
    'cancel',
    'steer',
])

async function getRouteParams(params: Promise<unknown>) {
    const resolved = await params
    if (!resolved || typeof resolved !== 'object') return { id: '', approvalId: '' }
    const record = resolved as { id?: unknown; approvalId?: unknown }
    return {
        id: typeof record.id === 'string' ? record.id : '',
        approvalId: typeof record.approvalId === 'string' ? decodeURIComponent(record.approvalId) : '',
    }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { id, approvalId } = await getRouteParams(params)
        const existing = await prisma.codexSession.findFirst({
            where: { id, ownerId: user.userId },
            select: { id: true },
        })
        if (!existing) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })

        const body = await request.json().catch(() => null)
        const decision = body?.decision
        if (!APPROVAL_DECISIONS.has(decision)) {
            return NextResponse.json({ detail: 'Invalid approval decision' }, { status: 400 })
        }

        const result = await resolveCodexApprovalRequest({
            sessionId: id,
            approvalId,
            decision,
            message: normalizeCodexString(body?.message),
        })
        if (!result.ok) return NextResponse.json({ detail: result.detail }, { status: 409 })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Resolve Codex approval error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
