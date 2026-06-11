import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import { createLanguageModel, parseProviderType } from '@/lib/server/ai-providers'
import { runImageGenerationAttempt } from '@/lib/server/model-group-runner'

const DEFAULT_TEST_PROMPT =
    'hi, just testing the connection, if you see this message, plz respond with connection success'

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const connectionId = String(body?.connectionId || '').trim()
        const modelId = String(body?.modelId || '').trim()
        const prompt = String(body?.prompt || DEFAULT_TEST_PROMPT)

        if (!connectionId || !modelId) {
            return NextResponse.json({ detail: 'Missing connectionId or modelId.' }, { status: 400 })
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

        // An image connection is tested with a real (cheapest possible) generation.
        if (providerType === 'openai-image') {
            const result = await runImageGenerationAttempt({
                providerType,
                apiKey,
                baseUrl: connection.baseUrl,
                modelId,
                input: { prompt: 'A plain white circle on a black background.' },
                signal: request.signal,
            })
            return NextResponse.json({ text: result.text })
        }

        const model = createLanguageModel({
            providerType,
            apiKey,
            baseUrl: connection.baseUrl,
            modelId,
        })

        const result = await generateText({ model, prompt })

        return NextResponse.json({ text: result.text })
    } catch (error) {
        console.error('Connection test failed:', error)
        const message = error instanceof Error ? error.message : 'Failed to test connection.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to test connection.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
