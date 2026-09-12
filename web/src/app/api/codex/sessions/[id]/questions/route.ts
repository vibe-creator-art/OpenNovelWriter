import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { listCodexUserInputRequests, resolveCodexUserInput } from '@/lib/server/codex-user-input-bridge'

const prisma = getPrismaClient({ ensureModel: 'codexSession' })
type Context = { params: Promise<{ id: string }> }

async function authorize(request: NextRequest, context: Context) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id } = await context.params
    const session = await prisma.codexSession.findFirst({ where: { id, ownerId: user.userId }, select: { id: true } })
    return session ?? NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })
}

export async function GET(request: NextRequest, context: Context) {
    const session = await authorize(request, context)
    if (session instanceof NextResponse) return session
    return NextResponse.json({ requests: listCodexUserInputRequests(session.id) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest, context: Context) {
    const session = await authorize(request, context)
    if (session instanceof NextResponse) return session
    const body = await request.json().catch(() => null)
    if (typeof body?.requestId !== 'string') return NextResponse.json({ detail: 'Question id is required.' }, { status: 400 })
    const result = await resolveCodexUserInput(session.id, body.requestId, body)
    if (!result.ok) return NextResponse.json({ detail: result.detail }, { status: result.status })
    return NextResponse.json({ ok: true })
}
