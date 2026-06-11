import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import {
    getDefaultCodexAuthJson,
    getDefaultCodexConfig,
    type CodexConnectionProviderType,
    writeCodexConnectionFiles,
} from '@/lib/server/codex-connection-storage'
import { syncCodexConnectionAuthState } from '@/lib/server/codex-app-server'
import { syncActiveCodexConnectionCoreAgents, syncCodexConnectionCoreAgents } from '@/lib/server/codex-agent-sync'
import { syncActiveCodexConnectionMcp, syncCodexConnectionMcp } from '@/lib/server/codex-mcp-sync'
import { syncCodexConnectionSkills } from '@/lib/server/codex-skill-sync'
const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

function isProviderType(value: unknown): value is CodexConnectionProviderType {
    return value === 'openai-official' || value === 'custom'
}

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

export async function GET(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const connections = await prisma.codexConnection.findMany({
        where: { ownerId: user.userId },
        orderBy: { createdAt: 'asc' },
    })
    await Promise.all([
        syncActiveCodexConnectionCoreAgents(user.userId),
        syncActiveCodexConnectionMcp(user.userId),
    ])

    return NextResponse.json(connections.map(serializeConnection))
}

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    let createdConnectionId: string | null = null

    try {
        const body = await request.json()
        const providerType = body?.providerType
        const name = String(body?.name || '').trim()
        const note =
            typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null

        if (!isProviderType(providerType)) {
            return NextResponse.json({ detail: 'Unsupported provider type.' }, { status: 400 })
        }

        if (!name) {
            return NextResponse.json({ detail: 'Missing connection name.' }, { status: 400 })
        }

        const connection = await prisma.codexConnection.create({
            data: {
                ownerId: user.userId,
                name,
                providerType,
                isActive: (await prisma.codexConnection.count({ where: { ownerId: user.userId, isActive: true } })) === 0,
                note,
            },
        })
        createdConnectionId = connection.id

        const files = await writeCodexConnectionFiles({
            ownerId: user.userId,
            connectionId: connection.id,
            providerType,
            authJson:
                typeof body?.authJson === 'string'
                    ? body.authJson
                    : getDefaultCodexAuthJson(providerType),
            configToml:
                typeof body?.configToml === 'string'
                    ? body.configToml
                    : getDefaultCodexConfig(providerType),
        })
        let configToml = files.configToml

        const synced = await syncCodexConnectionAuthState({
            connectionId: connection.id,
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
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create Codex connection.'
        if (typeof createdConnectionId === 'string') {
            await prisma.codexConnection.delete({ where: { id: createdConnectionId } }).catch(() => {})
        }
        console.error('Failed to create Codex connection:', error)
        const status =
            error instanceof SyntaxError
                ? 400
                : message.includes('Unique constraint')
                    ? 409
                    : 500
        return NextResponse.json({ detail: message }, { status })
    }
}
