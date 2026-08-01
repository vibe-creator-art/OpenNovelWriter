import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { parseCodexUpstreamFormat } from '@/lib/codex-config'
import { getPrismaClient } from '@/lib/db'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import { fetchModelsForProvider } from '@/lib/server/ai-providers'

const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    try {
        const body = await request.json()
        let apiKey = String(body?.apiKey || '').trim()
        const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''
        let upstreamFormat = parseCodexUpstreamFormat(body?.upstreamFormat)
        const connectionId = typeof body?.connectionId === 'string' ? body.connectionId.trim() : ''

        if ((!apiKey || !upstreamFormat) && connectionId) {
            const connection = await prisma.codexConnection.findFirst({
                where: {
                    id: connectionId,
                    ownerId: user.userId,
                    providerType: 'custom',
                },
                select: { encryptedApiKey: true, upstreamFormat: true },
            })
            if (!connection) {
                return NextResponse.json({ detail: 'Codex connection not found.' }, { status: 404 })
            }
            if (!apiKey && connection.encryptedApiKey) {
                apiKey = decryptApiKey(connection.encryptedApiKey)
            }
            upstreamFormat ??= parseCodexUpstreamFormat(connection.upstreamFormat)
        }

        if (!apiKey) {
            return NextResponse.json({ detail: 'Missing API key.' }, { status: 400 })
        }

        const models = upstreamFormat === 'anthropic-messages'
            ? await fetchAnthropicModels(baseUrl, apiKey)
            : await fetchModelsForProvider({ providerType: 'openai-chat', apiKey, baseUrl })

        return NextResponse.json({ models })
    } catch (error) {
        console.error('Failed to fetch Codex custom models:', error)
        const message = error instanceof Error ? error.message : 'Failed to fetch models.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to fetch models.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}

async function fetchAnthropicModels(baseUrl: string, apiKey: string) {
    const normalized = baseUrl.replace(/\/+$/, '')
    const endpoint = /\/v1\/messages$/i.test(normalized)
        ? normalized.replace(/\/messages$/i, '/models')
        : /\/v1$/i.test(normalized)
          ? `${normalized}/models`
          : `${normalized}/v1/models`
    const response = await fetch(endpoint, {
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body?.error?.message || 'Failed to fetch Anthropic models.')
    const models = Array.isArray(body?.data)
        ? body.data
            .map((model: { id?: unknown; display_name?: unknown }) => {
                const id = typeof model.id === 'string' ? model.id.trim() : ''
                const name = typeof model.display_name === 'string' ? model.display_name.trim() : id
                return { id, name: name || id }
            })
            .filter((model: { id: string }) => model.id)
        : []
    if (models.length === 0) throw new Error('Anthropic returned no models.')
    return models
}
