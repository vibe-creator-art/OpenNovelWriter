import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { getCodexLoginSession } from '@/lib/server/codex-app-server'
import { ensureCodexConnectionHome } from '@/lib/server/codex-connection-storage'
import { readCodexRateLimits } from '@/lib/server/codex-app-server'
const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

function serializeConnection(connection: {
    id: string
    name: string
    providerType: string
    isActive: boolean
    note: string | null
    authStatus: string
    authType: string | null
    accountEmail: string | null
    accountPlan: string | null
    lastAuthError: string | null
    createdAt: Date
    updatedAt: Date
}) {
    return {
        id: connection.id,
        name: connection.name,
        providerType: connection.providerType,
        isActive: connection.isActive,
        note: connection.note,
        authStatus: connection.authStatus,
        authType: connection.authType,
        accountEmail: connection.accountEmail,
        accountPlan: connection.accountPlan,
        lastAuthError: connection.lastAuthError,
        createdAt: connection.createdAt.toISOString(),
        updatedAt: connection.updatedAt.toISOString(),
    }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

    return NextResponse.json({
        connection: serializeConnection(connection),
        session: getCodexLoginSession(connection.id),
        rateLimits:
            connection.providerType === 'openai-official' && connection.authStatus === 'authenticated'
                ? await readCodexRateLimits(
                    await ensureCodexConnectionHome(user.userId, connection.id)
                ).catch(() => null)
                : null,
    })
}
