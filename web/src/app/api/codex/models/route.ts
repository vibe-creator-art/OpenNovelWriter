import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
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
        const connectionId = typeof body?.connectionId === 'string' ? body.connectionId.trim() : ''

        if (!apiKey && connectionId) {
            const connection = await prisma.codexConnection.findFirst({
                where: {
                    id: connectionId,
                    ownerId: user.userId,
                    providerType: 'custom',
                },
                select: { encryptedApiKey: true },
            })
            if (!connection) {
                return NextResponse.json({ detail: 'Codex connection not found.' }, { status: 404 })
            }
            if (connection.encryptedApiKey) {
                apiKey = decryptApiKey(connection.encryptedApiKey)
            }
        }

        if (!apiKey) {
            return NextResponse.json({ detail: 'Missing API key.' }, { status: 400 })
        }

        const models = await fetchModelsForProvider({
            providerType: 'openai-chat',
            apiKey,
            baseUrl,
        })

        return NextResponse.json({ models })
    } catch (error) {
        console.error('Failed to fetch Codex custom models:', error)
        const message = error instanceof Error ? error.message : 'Failed to fetch models.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to fetch models.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
