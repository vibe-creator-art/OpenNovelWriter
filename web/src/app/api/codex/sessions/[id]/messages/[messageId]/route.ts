import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { getLiveCodexMessages } from '@/lib/server/codex-live-messages'
import { parseCodexSessionMessages } from '@/lib/server/codex-session'

const prisma = getPrismaClient({ ensureModel: 'codexSession' })

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id, messageId } = await params
    const session = await prisma.codexSession.findFirst({
        where: { id, ownerId: user.userId },
        select: { messagesJson: true },
    })
    if (!session) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })
    const messages = getLiveCodexMessages(id) ?? parseCodexSessionMessages(session.messagesJson)
    const message = messages.find((item) => item.id === messageId)
    if (!message) return NextResponse.json({ detail: 'Codex message not found' }, { status: 404 })
    return NextResponse.json({ message })
}
