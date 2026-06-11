import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import {
    deleteCodexConnectionHome,
    readCodexConnectionFiles,
    type CodexConnectionProviderType,
    writeCodexConnectionFiles,
} from '@/lib/server/codex-connection-storage'
import { syncCodexConnectionAuthState } from '@/lib/server/codex-app-server'
import { readCodexRateLimits } from '@/lib/server/codex-app-server'
import { syncCodexConnectionCoreAgents } from '@/lib/server/codex-agent-sync'
import { syncCodexConnectionMcp } from '@/lib/server/codex-mcp-sync'
import { syncCodexConnectionSkills } from '@/lib/server/codex-skill-sync'
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

async function getOwnedConnection(userId: string, id: string) {
    return prisma.codexConnection.findFirst({
        where: { id, ownerId: userId },
    })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await context.params
    const connection = await getOwnedConnection(user.userId, id)
    if (!connection) {
        return NextResponse.json({ detail: 'Not found' }, { status: 404 })
    }

    const files = await readCodexConnectionFiles(user.userId, connection.id)
    let configToml = files.configToml
    if (connection.isActive) {
        const [, mcpSync] = await Promise.all([
            syncCodexConnectionCoreAgents({
                ownerId: user.userId,
                connectionId: connection.id,
            }),
            syncCodexConnectionMcp({
                ownerId: user.userId,
                connectionId: connection.id,
            }),
        ])
        configToml = mcpSync.configToml
    }
    const rateLimits =
        connection.providerType === 'openai-official' && connection.authStatus === 'authenticated'
            ? await readCodexRateLimits(files.home).catch(() => null)
            : null

    return NextResponse.json({
        connection: serializeConnection(connection),
        authJson: files.authJson,
        configToml,
        rateLimits,
    })
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    try {
        const { id } = await context.params
        const connection = await getOwnedConnection(user.userId, id)
        if (!connection) {
            return NextResponse.json({ detail: 'Not found' }, { status: 404 })
        }

        const body = await request.json()
        const name = String(body?.name || '').trim()
        if (!name) {
            return NextResponse.json({ detail: 'Missing connection name.' }, { status: 400 })
        }

        const providerType = body?.providerType as CodexConnectionProviderType
        if (providerType !== 'openai-official' && providerType !== 'custom') {
            return NextResponse.json({ detail: 'Unsupported provider type.' }, { status: 400 })
        }

        const note =
            typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null
        const isActive = body?.isActive === true

        const updated = await prisma.$transaction(async (tx) => {
            if (isActive) {
                await tx.codexConnection.updateMany({
                    where: { ownerId: user.userId, NOT: { id: connection.id } },
                    data: { isActive: false },
                })
            }

            return tx.codexConnection.update({
                where: { id: connection.id },
                data: {
                    name,
                    providerType,
                    isActive,
                    note,
                },
            })
        })

        const files = await writeCodexConnectionFiles({
            ownerId: user.userId,
            connectionId: updated.id,
            providerType,
            authJson: typeof body?.authJson === 'string' ? body.authJson : undefined,
            configToml: typeof body?.configToml === 'string' ? body.configToml : undefined,
        })
        let configToml = files.configToml

        const synced = await syncCodexConnectionAuthState({
            connectionId: updated.id,
            ownerId: user.userId,
            codexHome: files.home,
        })
        if (synced.isActive) {
            await Promise.all([
                syncCodexConnectionCoreAgents({
                    ownerId: user.userId,
                    connectionId: synced.id,
                }),
                syncCodexConnectionSkills({
                    ownerId: user.userId,
                    connectionId: synced.id,
                }),
                syncCodexConnectionMcp({
                    ownerId: user.userId,
                    connectionId: synced.id,
                }).then((result) => {
                    configToml = result.configToml
                }),
            ])
        }

        return NextResponse.json({
            connection: serializeConnection(synced),
            authJson: files.authJson,
            configToml,
            rateLimits:
                synced.providerType === 'openai-official' && synced.authStatus === 'authenticated'
                    ? await readCodexRateLimits(files.home).catch(() => null)
                    : null,
        })
    } catch (error) {
        console.error('Failed to update Codex connection:', error)
        const message = error instanceof Error ? error.message : 'Failed to update Codex connection.'
        const status =
            error instanceof SyntaxError
                ? 400
                : message.includes('Unique constraint')
                    ? 409
                    : 500
        return NextResponse.json({ detail: message }, { status })
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await context.params
    const connection = await getOwnedConnection(user.userId, id)
    if (!connection) {
        return NextResponse.json({ detail: 'Not found' }, { status: 404 })
    }

    await prisma.codexConnection.delete({ where: { id: connection.id } })
    await deleteCodexConnectionHome(user.userId, connection.id)

    return NextResponse.json({ message: 'Deleted' })
}
