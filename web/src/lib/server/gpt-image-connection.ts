import { isImageGenerationModel } from '@/lib/cherrystudio-model-config'
import { getPrismaClient } from '@/lib/db'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import { parseOpenAiModelList, type ProviderModel } from '@/lib/server/provider-model-list'

export type GptImageProvider = {
    apiKey: string
    baseUrl: string
    modelId: string
}

export function normalizeGptImageBaseUrl(value: unknown) {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (!raw) throw new Error('GPT Image Base URL is required.')

    let parsed: URL
    try {
        parsed = new URL(raw)
    } catch {
        throw new Error('GPT Image Base URL must be a valid HTTP(S) URL.')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('GPT Image Base URL must use HTTP or HTTPS.')
    }
    return raw.replace(/\/+$/, '')
}

export function normalizeGptImageModels(value: unknown, baseUrl: string): ProviderModel[] {
    const models = parseOpenAiModelList(value).filter((model) =>
        isImageGenerationModel({ modelId: model.id, baseUrl })
    )
    return Array.from(new Map(models.map((model) => [model.id, model])).values())
}

export async function fetchGptImageModels(options: { baseUrl: string; apiKey: string }) {
    const baseUrl = normalizeGptImageBaseUrl(options.baseUrl)
    const response = await fetch(`${baseUrl}/models`, {
        headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
        },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(body?.error?.message || 'Failed to fetch GPT Image models.')
    }

    const models = normalizeGptImageModels(body?.data, baseUrl)
    if (models.length === 0) {
        throw new Error('No image generation models are available for this API key.')
    }
    return models
}

export async function resolveGptImageProvider(ownerId: string): Promise<GptImageProvider> {
    const prisma = getPrismaClient({ ensureModel: 'gptImageConnection' })
    const connection = await prisma.gptImageConnection.findUnique({ where: { ownerId } })
    if (!connection) {
        throw new Error('GPT Image is not configured. Configure it in Settings > Other Connections.')
    }
    return {
        apiKey: decryptApiKey(connection.encryptedApiKey),
        baseUrl: connection.baseUrl,
        modelId: connection.modelId,
    }
}
