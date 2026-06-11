import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import { fetchModelsForProvider, parseProviderType } from '@/lib/server/ai-providers'

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const connectionId = String(body?.connectionId || '').trim()
        if (!connectionId) {
            return NextResponse.json({ detail: 'Missing connectionId.' }, { status: 400 })
        }

        const connection = await prisma.aiConnection.findFirst({
            where: { id: connectionId, ownerId: user.userId },
        })

        if (!connection) {
            return NextResponse.json({ detail: 'Not found' }, { status: 404 })
        }

        const providerType = parseProviderType(connection.providerType)
        if (!providerType) {
            return NextResponse.json({ detail: 'Unsupported providerType.' }, { status: 400 })
        }

        const apiKey = decryptApiKey(connection.encryptedApiKey)
        const models = await fetchModelsForProvider({
            providerType,
            apiKey,
            baseUrl: connection.baseUrl,
        })

        await prisma.aiConnection.update({
            where: { id: connection.id },
            data: {
                modelsJson: JSON.stringify(models),
                lastFetchedAt: new Date(),
            },
        })

        return NextResponse.json({ models })
    } catch (error) {
        console.error('Model list failed:', error)
        const message = error instanceof Error ? error.message : 'Failed to fetch models.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to fetch models.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
