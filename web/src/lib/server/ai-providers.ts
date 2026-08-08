import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { isImageGenerationModel } from '@/lib/cherrystudio-model-config'
import {
    parseOpenAiModelList,
    requireProviderModels,
    type ProviderModel,
} from '@/lib/server/provider-model-list'

/**
 * Connection formats:
 * - `openai-chat`  — chat completions (`/chat/completions`)
 * - `gemini`       — Gemini API native `generateContent`
 */
export type ProviderType = 'openai-chat' | 'gemini'

export function parseProviderType(value: unknown): ProviderType | null {
    return value === 'openai-chat' || value === 'gemini' ? value : null
}

export type AiModel = ProviderModel

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export function normalizeBaseUrl(value: string) {
    return value.replace(/\/+$/, '')
}

export function getDefaultBaseUrl(providerType: ProviderType) {
    return providerType === 'gemini' ? DEFAULT_GEMINI_BASE_URL : DEFAULT_OPENAI_BASE_URL
}

export function resolveBaseUrl(providerType: ProviderType, value?: string | null) {
    return normalizeBaseUrl(value || getDefaultBaseUrl(providerType))
}

async function fetchOpenAiModels(baseUrl: string, apiKey: string): Promise<AiModel[]> {
    const response = await fetch(`${baseUrl}/models`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to fetch models.')
    }

    return parseOpenAiModelList(data?.data)
}

async function fetchGeminiModels(baseUrl: string, apiKey: string): Promise<AiModel[]> {
    const response = await fetch(`${baseUrl}/models`, {
        headers: { 'x-goog-api-key': apiKey },
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error?.message || 'Failed to fetch models.')
    }

    return Array.isArray(data?.models)
        ? data.models
              .map((model: { name?: string; displayName?: string }) => {
                  const id = String(model?.name ?? '').replace(/^models\//, '')
                  return { id, name: model?.displayName?.trim() || id }
              })
              .filter((model: AiModel) => model.id)
        : []
}

export async function fetchModelsForProvider(options: {
    providerType: ProviderType
    apiKey: string
    baseUrl?: string | null
}) {
    const { providerType, apiKey } = options
    const baseUrl = resolveBaseUrl(providerType, options.baseUrl)

    const models =
        providerType === 'gemini'
            ? await fetchGeminiModels(baseUrl, apiKey)
            : await fetchOpenAiModels(baseUrl, apiKey)

    const chatModels = models.filter((model) => !isImageGenerationModel({ modelId: model.id, baseUrl }))
    return requireProviderModels(chatModels)
}

export function createLanguageModel(options: {
    providerType: ProviderType
    apiKey: string
    baseUrl?: string | null
    modelId: string
}): LanguageModel {
    const { providerType, apiKey, modelId } = options
    const baseURL = resolveBaseUrl(providerType, options.baseUrl)

    if (providerType === 'openai-chat') {
        return createOpenAICompatible({ apiKey, baseURL, name: 'openaiChat' }).chatModel(
            modelId
        ) as unknown as LanguageModel
    }

    if (providerType === 'gemini') {
        // Relay catalogs use vendor-prefixed ids ("google/gemini-..."). The SDK
        // treats any id containing "/" as a full resource path and skips the
        // `models/` segment, producing a 404 — anchor the path ourselves.
        const modelPath =
            modelId.startsWith('models/') || modelId.startsWith('tunedModels/')
                ? modelId
                : `models/${modelId}`
        return createGoogleGenerativeAI({ apiKey, baseURL })(modelPath) as unknown as LanguageModel
    }

    throw new Error('This connection format does not serve chat models.')
}
