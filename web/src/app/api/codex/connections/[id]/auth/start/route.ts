import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { startCodexChatGptLogin } from '@/lib/server/codex-app-server'
import { ensureCodexConnectionHome } from '@/lib/server/codex-connection-storage'
const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await context.params
    const connection = await prisma.codexConnection.findFirst({
        where: { id, ownerId: user.userId },
    })

    if (!connection) {
        return NextResponse.json({ detail: 'Not found' }, { status: 404 })
    }

    if (connection.providerType !== 'openai-official') {
        return NextResponse.json(
            { detail: 'ChatGPT authorization is only supported for OpenAI Official connections.' },
            { status: 400 }
        )
    }

    try {
        const body = await request.json().catch(() => null)
        const loginType =
            body?.type === 'chatgptDeviceCode'
                ? 'chatgptDeviceCode'
                : 'chatgpt'
        const codexHome = await ensureCodexConnectionHome(user.userId, connection.id)
        const login = await startCodexChatGptLogin({
            connectionId: connection.id,
            ownerId: user.userId,
            codexHome,
            type: loginType,
        })

        return NextResponse.json(login)
    } catch (error) {
        console.error('Failed to start Codex login:', error)
        const message = error instanceof Error ? error.message : 'Failed to start Codex authorization.'
        return NextResponse.json({ detail: message }, { status: 500 })
    }
}
