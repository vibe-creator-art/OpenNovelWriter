import { NextRequest, NextResponse } from 'next/server'

import { normalizeCodexProviderModels, parseCodexUpstreamFormat, type CodexConnectionProviderType } from '@/lib/codex-config'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { encryptApiKey } from '@/lib/server/ai-credentials'
import { syncCodexConnectionCoreAgents } from '@/lib/server/codex-agent-sync'
import { readCodexRateLimits, syncCodexConnectionAuthState } from '@/lib/server/codex-app-server'
import { deleteCodexConnectionHome, readCodexConnectionFiles, writeCodexConnectionFiles } from '@/lib/server/codex-connection-storage'
import { syncCodexConnectionMcp } from '@/lib/server/codex-mcp-sync'
import { syncCodexConnectionRuntimeFiles } from '@/lib/server/codex-runtime-config'
import { syncCodexConnectionSkills } from '@/lib/server/codex-skill-sync'
import { serializeCodexConnection } from '@/lib/server/codex-connection-serialize'

const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

async function getOwnedConnection(userId: string, id: string) {
    return prisma.codexConnection.findFirst({ where: { id, ownerId: userId } })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id } = await context.params
    const connection = await getOwnedConnection(user.userId, id)
    if (!connection) return NextResponse.json({ detail: 'Not found' }, { status: 404 })

    if (connection.providerType === 'custom') await syncCodexConnectionRuntimeFiles(connection)
    const files = await readCodexConnectionFiles(user.userId, connection.id)
    let configToml = files.configToml
    if (connection.isActive) {
        const [, mcp] = await Promise.all([
            syncCodexConnectionCoreAgents({ ownerId: user.userId, connectionId: connection.id }),
            syncCodexConnectionMcp({ ownerId: user.userId, connectionId: connection.id }),
        ])
        configToml = mcp.configToml
    }
    const rateLimits = connection.providerType === 'openai-official' && connection.authStatus === 'authenticated'
        ? await readCodexRateLimits(files.home).catch(() => null)
        : null
    return NextResponse.json({ connection: serializeCodexConnection(connection), authJson: files.authJson, configToml, rateLimits })
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    try {
        const { id } = await context.params
        const connection = await getOwnedConnection(user.userId, id)
        if (!connection) return NextResponse.json({ detail: 'Not found' }, { status: 404 })
        const body = await request.json()
        const name = String(body?.name || '').trim()
        const providerType = body?.providerType as CodexConnectionProviderType
        if (!name) return NextResponse.json({ detail: 'Missing connection name.' }, { status: 400 })
        if (providerType !== 'openai-official' && providerType !== 'custom') return NextResponse.json({ detail: 'Unsupported provider type.' }, { status: 400 })

        const custom = providerType === 'custom' ? parseCustomUpdate(body, connection.encryptedApiKey) : null
        const isActive = body?.isActive === true
        const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null
        let updated = await prisma.$transaction(async (tx) => {
            if (isActive) await tx.codexConnection.updateMany({ where: { ownerId: user.userId, NOT: { id } }, data: { isActive: false } })
            return tx.codexConnection.update({
                where: { id },
                data: {
                    name, providerType, isActive, note,
                    upstreamFormat: custom?.upstreamFormat ?? null,
                    baseUrl: custom?.baseUrl ?? null,
                    encryptedApiKey: custom ? custom.encryptedApiKey : null,
                    defaultModelId: custom?.defaultModelId ?? null,
                    modelsJson: custom ? JSON.stringify(custom.models) : '[]',
                    ...(custom ? { authStatus: 'authenticated', authType: 'api_key', lastAuthError: null } : {}),
                },
            })
        })

        if (providerType === 'custom') {
            await syncCodexConnectionRuntimeFiles(updated)
        } else {
            const files = await writeCodexConnectionFiles({
                ownerId: user.userId, connectionId: id, providerType,
                authJson: typeof body?.authJson === 'string' ? body.authJson : undefined,
                configToml: typeof body?.configToml === 'string' ? body.configToml : undefined,
            })
            updated = await syncCodexConnectionAuthState({ connectionId: id, ownerId: user.userId, codexHome: files.home })
        }
        if (updated.isActive) await syncConnectionAssets(updated)
        const files = await readCodexConnectionFiles(user.userId, id)
        return NextResponse.json({
            connection: serializeCodexConnection(updated), authJson: files.authJson, configToml: files.configToml,
            rateLimits: updated.providerType === 'openai-official' && updated.authStatus === 'authenticated'
                ? await readCodexRateLimits(files.home).catch(() => null) : null,
        })
    } catch (error) {
        console.error('Failed to update Codex connection:', error)
        const message = error instanceof Error ? error.message : 'Failed to update Codex connection.'
        return NextResponse.json({ detail: message }, { status: error instanceof SyntaxError ? 400 : message.includes('Unique constraint') ? 409 : 400 })
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id } = await context.params
    const connection = await getOwnedConnection(user.userId, id)
    if (!connection) return NextResponse.json({ detail: 'Not found' }, { status: 404 })
    await prisma.codexConnection.delete({ where: { id } })
    await deleteCodexConnectionHome(user.userId, id)
    return NextResponse.json({ message: 'Deleted' })
}

function parseCustomUpdate(body: Record<string, unknown>, existingEncryptedApiKey: string | null) {
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : ''
    const upstreamFormat = parseCodexUpstreamFormat(body.upstreamFormat)
    const models = normalizeCodexProviderModels(body.models)
    const defaultModelId = typeof body.defaultModelId === 'string' ? body.defaultModelId.trim() : ''
    if (!baseUrl) throw new Error('Missing Codex upstream base URL.')
    if (!upstreamFormat) throw new Error('Unsupported Codex upstream format.')
    if (models.length === 0) throw new Error('Add at least one Codex model.')
    if (!models.some((model) => model.id === defaultModelId)) throw new Error('The default Codex model must be present in the model list.')
    const encryptedApiKey = apiKey ? encryptApiKey(apiKey) : existingEncryptedApiKey
    if (!encryptedApiKey) throw new Error('Missing Codex upstream API key.')
    return { baseUrl, upstreamFormat, models, defaultModelId, encryptedApiKey }
}

async function syncConnectionAssets(connection: { ownerId: string; id: string }) {
    await Promise.all([
        syncCodexConnectionCoreAgents({ ownerId: connection.ownerId, connectionId: connection.id }),
        syncCodexConnectionSkills({ ownerId: connection.ownerId, connectionId: connection.id }),
        syncCodexConnectionMcp({ ownerId: connection.ownerId, connectionId: connection.id }),
    ])
}
