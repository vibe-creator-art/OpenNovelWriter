import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ImageModel, LanguageModel } from 'ai'
import { isDedicatedImageGenerationModel, isImageGenerationModel } from '@/lib/cherrystudio-model-config'

/**
 * Connection formats:
 * - `openai-chat`  — chat completions (`/chat/completions`)
 * - `openai-image` — image generation/editing (`/images/generations`, `/images/edits`)
 * - `gemini`       — Gemini API native `generateContent`; required for Gemini
 *                    image-output models (nano banana), whose generated images
 *                    have no representation in the OpenAI chat format
 */
export type ProviderType = 'openai-chat' | 'openai-image' | 'gemini'

export function parseProviderType(value: unknown): ProviderType | null {
    return value === 'openai-chat' || value === 'openai-image' || value === 'gemini' ? value : null
}

export type AiModel = {
    id: string
    name: string
}

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

    return Array.isArray(data?.data)
        ? data.data.map((model: { id: string }) => ({ id: model.id, name: model.id }))
        : []
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

    // Relays list their full catalog on `/models` regardless of endpoint, so trim
    // each connection's list to what its format can actually serve. Detection-driven;
    // when the filter would empty a non-empty list (unknown relay naming), keep the
    // full list instead of locking the user out.
    const filtered =
        providerType === 'openai-image'
            ? models.filter((model) => isImageGenerationModel({ modelId: model.id, baseUrl }))
            : providerType === 'openai-chat'
              ? models.filter((model) => !isDedicatedImageGenerationModel({ modelId: model.id, baseUrl }))
              : models
    return filtered.length > 0 ? filtered : models
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

/**
 * The SDK hardcodes `response_format: "b64_json"` on `/images/generations`.
 * dall-e-style endpoints require it (their default is `url`), but gpt-image
 * family endpoints reject the parameter outright (they only ever return
 * b64_json). Detection-driven instead of a model-id list: send it, and if the
 * provider rejects specifically that parameter, retry once without it.
 */
const imageGenerationFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    if (response.status !== 400 && response.status !== 422) return response
    if (typeof init?.body !== 'string' || !init.body.includes('"response_format"')) return response

    const errorText = await response
        .clone()
        .text()
        .catch(() => '')
    if (!errorText.includes('response_format')) return response

    const { response_format: _dropped, ...body } = JSON.parse(init.body) as Record<string, unknown>
    return fetch(input, { ...init, body: JSON.stringify(body) })
}

export function createImageModel(options: {
    providerType: ProviderType
    apiKey: string
    baseUrl?: string | null
    modelId: string
}): ImageModel {
    if (options.providerType !== 'openai-image') {
        throw new Error('This connection format does not serve image models.')
    }
    return createOpenAICompatible({
        apiKey: options.apiKey,
        baseURL: resolveBaseUrl(options.providerType, options.baseUrl),
        name: 'openaiChat',
        fetch: imageGenerationFetch,
    }).imageModel(options.modelId) as unknown as ImageModel
}
