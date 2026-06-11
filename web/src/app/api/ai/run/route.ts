import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import { createLanguageModel, parseProviderType } from '@/lib/server/ai-providers'
import { runImageGenerationAttempt, type RunModelMessage } from '@/lib/server/model-group-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const connectionId = String(body?.connectionId || '').trim()
        const modelId = String(body?.modelId || '').trim()

        const messages = (body?.messages ?? null) as RunModelMessage[] | null
        const prompt = typeof body?.prompt === 'string' ? body.prompt : null

        if (!connectionId || !modelId) {
            return NextResponse.json({ detail: 'Missing connectionId or modelId.' }, { status: 400 })
        }

        if ((!messages || messages.length === 0) && !prompt) {
            return NextResponse.json({ detail: 'Missing messages or prompt.' }, { status: 400 })
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

        if (providerType === 'openai-image') {
            const result = await runImageGenerationAttempt({
                providerType,
                apiKey,
                baseUrl: connection.baseUrl,
                modelId,
                input: { messages: messages ?? undefined, prompt: prompt ?? undefined },
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

        const temperature =
            typeof body?.temperature === 'number' && Number.isFinite(body.temperature)
                ? body.temperature
                : undefined
        const maxTokens =
            typeof body?.maxTokens === 'number' && Number.isFinite(body.maxTokens)
                ? body.maxTokens
                : undefined
        const system = typeof body?.system === 'string' ? body.system : undefined
        const requestPayload = {
            model,
            system,
            temperature,
            maxOutputTokens: maxTokens,
            abortSignal: request.signal,
            ...(messages && messages.length > 0 ? { messages } : { prompt: prompt || '' }),
        }

        const result = await generateText(requestPayload)

        return NextResponse.json({
            text: result.text,
            ...(result.reasoningText?.trim() ? { reasoningText: result.reasoningText } : {}),
        })
    } catch (error) {
        console.error('AI run failed:', error)
        const message = error instanceof Error ? error.message : 'Failed to run model.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to run model.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
