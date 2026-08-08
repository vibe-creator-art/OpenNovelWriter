import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { encryptApiKey } from '@/lib/server/ai-credentials'
import {
    normalizeGptImageBaseUrl,
    normalizeGptImageModels,
} from '@/lib/server/gpt-image-connection'

function serializeConnection(connection: {
    baseUrl: string
    modelId: string
    modelsJson: string
}) {
    return {
        baseUrl: connection.baseUrl,
        modelId: connection.modelId,
        models: normalizeGptImageModels(
            JSON.parse(connection.modelsJson || '[]'),
            connection.baseUrl
        ),
        hasApiKey: true,
    }
}

export async function GET(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const prisma = getPrismaClient({ ensureModel: 'gptImageConnection' })
    const connection = await prisma.gptImageConnection.findUnique({
        where: { ownerId: user.userId },
    })
    return NextResponse.json({ connection: connection ? serializeConnection(connection) : null })
}

export async function PUT(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const body = await request.json().catch(() => null)
    let baseUrl: string
    try {
        baseUrl = normalizeGptImageBaseUrl(body?.baseUrl)
    } catch (error) {
        return NextResponse.json(
            { detail: error instanceof Error ? error.message : 'Invalid Base URL.' },
            { status: 400 }
        )
    }

    const modelId = typeof body?.modelId === 'string' ? body.modelId.trim() : ''
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    const models = normalizeGptImageModels(body?.models, baseUrl)
    if (!modelId || !models.some((model) => model.id === modelId)) {
        return NextResponse.json(
            { detail: 'Select a model from the fetched GPT Image models.' },
            { status: 400 }
        )
    }

    const prisma = getPrismaClient({ ensureModel: 'gptImageConnection' })
    const existing = await prisma.gptImageConnection.findUnique({
        where: { ownerId: user.userId },
        select: { encryptedApiKey: true },
    })
    if (!apiKey && !existing) {
        return NextResponse.json({ detail: 'API key is required.' }, { status: 400 })
    }

    const encryptedApiKey = apiKey ? encryptApiKey(apiKey) : existing!.encryptedApiKey
    const connection = await prisma.gptImageConnection.upsert({
        where: { ownerId: user.userId },
        update: {
            baseUrl,
            encryptedApiKey,
            modelId,
            modelsJson: JSON.stringify(models),
        },
        create: {
            ownerId: user.userId,
            baseUrl,
            encryptedApiKey,
            modelId,
            modelsJson: JSON.stringify(models),
        },
    })
    return NextResponse.json({ connection: serializeConnection(connection) })
}
