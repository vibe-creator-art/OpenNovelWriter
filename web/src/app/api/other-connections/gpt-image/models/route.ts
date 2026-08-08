import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import {
    fetchGptImageModels,
    normalizeGptImageBaseUrl,
} from '@/lib/server/gpt-image-connection'

export async function POST(request: NextRequest) {
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

    let apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!apiKey) {
        const prisma = getPrismaClient({ ensureModel: 'gptImageConnection' })
        const connection = await prisma.gptImageConnection.findUnique({
            where: { ownerId: user.userId },
            select: { encryptedApiKey: true },
        })
        if (connection) apiKey = decryptApiKey(connection.encryptedApiKey)
    }
    if (!apiKey) return NextResponse.json({ detail: 'API key is required.' }, { status: 400 })

    try {
        const models = await fetchGptImageModels({ baseUrl, apiKey })
        return NextResponse.json({ models })
    } catch (error) {
        console.error('Failed to fetch GPT Image models:', error)
        const message = error instanceof Error ? error.message : 'Failed to fetch GPT Image models.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to fetch GPT Image models.' : message
        return NextResponse.json({ detail }, { status: 502 })
    }
}
