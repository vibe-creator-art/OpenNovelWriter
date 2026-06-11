import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { encryptApiKey } from '@/lib/server/ai-credentials'
import { fetchModelsForProvider, resolveBaseUrl, parseProviderType } from '@/lib/server/ai-providers'

export async function GET(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const connections = await prisma.aiConnection.findMany({
        where: { ownerId: user.userId },
        orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(
        connections.map((connection) => ({
            id: connection.id,
            name: connection.name,
            providerType: connection.providerType,
            baseUrl: connection.baseUrl,
            isActive: connection.isActive,
            models: JSON.parse(connection.modelsJson || '[]'),
            lastFetchedAt: connection.lastFetchedAt?.toISOString() ?? null,
            createdAt: connection.createdAt.toISOString(),
            updatedAt: connection.updatedAt.toISOString(),
        }))
    )
}

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const providerType = parseProviderType(body?.providerType)
        const name = String(body?.name || '').trim()
        const apiKey = String(body?.apiKey || '').trim()
        const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : undefined

        if (!providerType || !name || !apiKey) {
            return NextResponse.json(
                { detail: 'Missing providerType, name, or apiKey.' },
                { status: 400 }
            )
        }

        const resolvedBaseUrl = resolveBaseUrl(providerType, baseUrl)

        const models = await fetchModelsForProvider({
            providerType,
            apiKey,
            baseUrl: resolvedBaseUrl,
        })

        const encryptedApiKey = encryptApiKey(apiKey)
        const now = new Date()

        const connection = await prisma.aiConnection.upsert({
            where: {
                ownerId_name: {
                    ownerId: user.userId,
                    name,
                },
            },
            update: {
                providerType,
                baseUrl: resolvedBaseUrl,
                encryptedApiKey,
                isActive: true,
                modelsJson: JSON.stringify(models),
                lastFetchedAt: now,
            },
            create: {
                ownerId: user.userId,
                name,
                providerType,
                baseUrl: resolvedBaseUrl,
                encryptedApiKey,
                isActive: true,
                modelsJson: JSON.stringify(models),
                lastFetchedAt: now,
            },
        })

        return NextResponse.json({
            connection: {
                id: connection.id,
                name: connection.name,
                providerType: connection.providerType,
                baseUrl: connection.baseUrl,
                isActive: connection.isActive,
                models,
                lastFetchedAt: connection.lastFetchedAt?.toISOString() ?? null,
                createdAt: connection.createdAt.toISOString(),
                updatedAt: connection.updatedAt.toISOString(),
            },
        })
    } catch (error) {
        console.error('Failed to create AI connection:', error)
        const message = error instanceof Error ? error.message : 'Failed to create connection.'
        return NextResponse.json(
            { detail: message === 'Missing AI_CREDENTIALS_SECRET' ? message : 'Failed to create connection.' },
            { status: 500 }
        )
    }
}
