import { NextRequest, NextResponse } from 'next/server'

import {
    normalizeCodexProviderModels,
    parseCodexUpstreamFormat,
    type CodexConnectionProviderType,
} from '@/lib/codex-config'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { encryptApiKey } from '@/lib/server/ai-credentials'
import { syncCodexConnectionCoreAgents } from '@/lib/server/codex-agent-sync'
import { syncCodexConnectionAuthState } from '@/lib/server/codex-app-server'
import {
    getDefaultCodexAuthJson,
    getDefaultCodexConfig,
    readCodexConnectionFiles,
    writeCodexConnectionFiles,
} from '@/lib/server/codex-connection-storage'
import { syncCodexConnectionMcp } from '@/lib/server/codex-mcp-sync'
import { syncCodexConnectionRuntimeFiles } from '@/lib/server/codex-runtime-config'
import { syncCodexConnectionSkills } from '@/lib/server/codex-skill-sync'
import { serializeCodexConnection } from '@/lib/server/codex-connection-serialize'

const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

function isProviderType(value: unknown): value is CodexConnectionProviderType {
    return value === 'openai-official' || value === 'custom'
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const connections = await prisma.codexConnection.findMany({
            where: { ownerId: user.userId },
            orderBy: { createdAt: 'asc' },
        })
        return NextResponse.json(connections.map(serializeCodexConnection))
    } catch (error) {
        console.error('Failed to list Codex connections:', error)
        const detail = error instanceof Error ? error.message : 'Failed to list Codex connections.'
        return NextResponse.json({ detail }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    let createdConnectionId: string | null = null
    try {
        const body = await request.json()
        const providerType = body?.providerType
        const name = String(body?.name || '').trim()
        const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null
        if (!isProviderType(providerType)) return NextResponse.json({ detail: 'Unsupported provider type.' }, { status: 400 })
        if (!name) return NextResponse.json({ detail: 'Missing connection name.' }, { status: 400 })

        const custom = providerType === 'custom' ? parseCustomCreate(body) : null
        const hasActive = await prisma.codexConnection.count({ where: { ownerId: user.userId, isActive: true } })
        const isActive = body?.isActive === true || hasActive === 0

        const connection = await prisma.$transaction(async (tx) => {
            if (isActive) {
                await tx.codexConnection.updateMany({ where: { ownerId: user.userId }, data: { isActive: false } })
            }
            return tx.codexConnection.create({
                data: {
                    ownerId: user.userId,
                    name,
                    providerType,
                    isActive,
                    note,
                    ...(custom ? {
                        upstreamFormat: custom.upstreamFormat,
                        baseUrl: custom.baseUrl,
                        encryptedApiKey: encryptApiKey(custom.apiKey),
                        defaultModelId: custom.defaultModelId,
                        modelsJson: JSON.stringify(custom.models),
                        authStatus: 'authenticated',
                        authType: 'api_key',
                    } : {}),
                },
            })
        })
        createdConnectionId = connection.id

        if (providerType === 'custom') {
            await syncCodexConnectionRuntimeFiles(connection)
            await syncConnectionAssets(connection)
            const files = await readCodexConnectionFiles(user.userId, connection.id)
            return NextResponse.json({ connection: serializeCodexConnection(connection), authJson: files.authJson, configToml: files.configToml, rateLimits: null })
        }

        const files = await writeCodexConnectionFiles({
            ownerId: user.userId,
            connectionId: connection.id,
            providerType,
            authJson: typeof body?.authJson === 'string' ? body.authJson : getDefaultCodexAuthJson(providerType),
            configToml: typeof body?.configToml === 'string' ? body.configToml : getDefaultCodexConfig(providerType),
        })
        const synced = await syncCodexConnectionAuthState({ connectionId: connection.id, ownerId: user.userId, codexHome: files.home })
        if (synced.isActive) await syncConnectionAssets(synced)
        const currentFiles = await readCodexConnectionFiles(user.userId, connection.id)
        return NextResponse.json({ connection: serializeCodexConnection(synced), authJson: currentFiles.authJson, configToml: currentFiles.configToml, rateLimits: null })
    } catch (error) {
        if (createdConnectionId) await prisma.codexConnection.delete({ where: { id: createdConnectionId } }).catch(() => {})
        console.error('Failed to create Codex connection:', error)
        const message = error instanceof Error ? error.message : 'Failed to create Codex connection.'
        return NextResponse.json({ detail: message }, { status: error instanceof SyntaxError ? 400 : message.includes('Unique constraint') ? 409 : 400 })
    }
}

function parseCustomCreate(body: Record<string, unknown>) {
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : ''
    const upstreamFormat = parseCodexUpstreamFormat(body.upstreamFormat)
    const models = normalizeCodexProviderModels(body.models)
    const defaultModelId = typeof body.defaultModelId === 'string' ? body.defaultModelId.trim() : ''
    if (!apiKey) throw new Error('Missing Codex upstream API key.')
    if (!baseUrl) throw new Error('Missing Codex upstream base URL.')
    if (!upstreamFormat) throw new Error('Unsupported Codex upstream format.')
    if (models.length === 0) throw new Error('Add at least one Codex model.')
    if (!models.some((model) => model.id === defaultModelId)) throw new Error('The default Codex model must be present in the model list.')
    return { apiKey, baseUrl, upstreamFormat, models, defaultModelId }
}

async function syncConnectionAssets(connection: { ownerId: string; id: string; isActive: boolean }) {
    if (!connection.isActive) return
    await Promise.all([
        syncCodexConnectionCoreAgents({ ownerId: connection.ownerId, connectionId: connection.id }),
        syncCodexConnectionSkills({ ownerId: connection.ownerId, connectionId: connection.id }),
        syncCodexConnectionMcp({ ownerId: connection.ownerId, connectionId: connection.id }),
    ])
}
