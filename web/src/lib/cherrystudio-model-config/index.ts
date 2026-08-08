import { getLoadedIcon, loadIcon } from './icons/loader'
import { resolveIconRef } from './icons/registry'
import { colonVariantTagToHyphen, normalizeModelId } from './models/normalize'
import { REGISTRY_PROVIDER_BASE_URLS } from './models/provider-base-urls'
import { REASONING_FAMILY_RULES } from './models/reasoning-families.gen'
import { matchReasoningMembership } from './models/reasoning-membership'
import {
    REGISTRY_FLAG,
    REGISTRY_MODEL_FLAGS,
    REGISTRY_PROVIDER_MODEL_FLAGS,
} from './models/registry-capabilities'

export type CherryStudioModelType =
    | 'vision'
    | 'reasoning'
    | 'tool'
    | 'reranker'
    | 'embedding'

export type CherryStudioDetectionState = Record<CherryStudioModelType, boolean>

export type CherryStudioDetectionInput = {
    modelId: string
    providerId?: string | null
    providerType?: 'openai-chat' | 'gemini' | null
    baseUrl?: string | null
}

export const CHERRY_STUDIO_MODEL_TYPE_ORDER: CherryStudioModelType[] = [
    'vision',
    'reasoning',
    'tool',
    'reranker',
    'embedding',
]

export function detectCherryStudioModelTypes(
    input: CherryStudioDetectionInput
): CherryStudioDetectionState {
    const flags = lookupRegistryFlags(input)
    if (flags === undefined) {
        return {
            vision: false,
            reasoning: matchReasoningMembership(input.modelId, REASONING_FAMILY_RULES),
            tool: false,
            reranker: false,
            embedding: false,
        }
    }

    const reranker = (flags & REGISTRY_FLAG.reranker) !== 0
    return {
        vision: (flags & REGISTRY_FLAG.vision) !== 0,
        reasoning: (flags & REGISTRY_FLAG.reasoning) !== 0,
        tool: (flags & REGISTRY_FLAG.tool) !== 0,
        reranker,
        embedding: !reranker && (flags & REGISTRY_FLAG.embedding) !== 0,
    }
}

export function isImageGenerationModel(input: CherryStudioDetectionInput): boolean {
    const flags = lookupRegistryFlags(input)
    return flags !== undefined && (flags & REGISTRY_FLAG.imageGeneration) !== 0
}

export function inferCherryStudioProviderId(
    input: Pick<CherryStudioDetectionInput, 'providerId' | 'providerType' | 'baseUrl'>
): string {
    const explicitProviderId = input.providerId?.trim().toLowerCase()
    if (explicitProviderId) return explicitProviderId

    const baseUrl = normalizeBaseUrl(input.baseUrl)
    if (baseUrl) {
        for (const [registeredBaseUrl, providerId] of REGISTRY_PROVIDER_BASE_URLS) {
            if (baseUrl === registeredBaseUrl || baseUrl.startsWith(`${registeredBaseUrl}/`)) {
                return providerId
            }
        }

        const host = getHostname(baseUrl)
        if (host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com')) {
            return 'azure-openai'
        }
        if (host.endsWith('.aiplatform.googleapis.com')) return 'vertexai'
    }

    if (input.providerType === 'gemini') return 'gemini'
    if (!baseUrl && input.providerType === 'openai-chat') {
        return 'openai'
    }
    return ''
}

export function resolveCherryStudioIcon(modelId: string, providerId: string) {
    return resolveIconRef(modelId, providerId)
}

export { getLoadedIcon as getLoadedCherryStudioIcon, loadIcon as loadCherryStudioIcon }
export type { IconRef as CherryStudioIconRef } from './icons/registry'
export type { ThemedIcon as CherryStudioIcon } from './icons/types'

function lookupRegistryFlags(input: CherryStudioDetectionInput): number | undefined {
    const providerId = inferCherryStudioProviderId(input)
    if (providerId) {
        const providerFlags = lookupFlagsInTable(
            REGISTRY_PROVIDER_MODEL_FLAGS,
            input.modelId,
            providerId
        )
        if (providerFlags !== undefined) return providerFlags
    }
    return lookupFlagsInTable(REGISTRY_MODEL_FLAGS, input.modelId)
}

type NormalizedIndexes = {
    regular: Map<string, number>
    sized: Map<string, number>
}

const normalizedIndexes = new WeakMap<Record<string, number>, Map<string, NormalizedIndexes>>()

function lookupFlagsInTable(
    table: Record<string, number>,
    modelId: string,
    providerId = ''
): number | undefined {
    const exactKey = providerId ? `${providerId}::${modelId}` : modelId
    const exact = table[exactKey]
    if (exact !== undefined) return exact

    const indexes = getNormalizedIndexes(table, providerId)
    if (colonVariantTagToHyphen(modelId) !== modelId) {
        return indexes.sized.get(normalizeModelId(modelId, { keepParameterSize: true }))
    }
    return indexes.regular.get(normalizeModelId(modelId))
}

function getNormalizedIndexes(
    table: Record<string, number>,
    providerId: string
): NormalizedIndexes {
    let indexesByProvider = normalizedIndexes.get(table)
    if (!indexesByProvider) {
        indexesByProvider = new Map()
        normalizedIndexes.set(table, indexesByProvider)
    }

    const cached = indexesByProvider.get(providerId)
    if (cached) return cached

    const indexes: NormalizedIndexes = { regular: new Map(), sized: new Map() }
    const providerPrefix = providerId ? `${providerId}::` : ''
    for (const [key, flags] of Object.entries(table)) {
        if (providerId && !key.startsWith(providerPrefix)) continue
        const id = providerId ? key.slice(providerPrefix.length) : key
        const regularId = normalizeModelId(id)
        const sizedId = normalizeModelId(id, { keepParameterSize: true })
        if (!indexes.regular.has(regularId)) indexes.regular.set(regularId, flags)
        if (!indexes.sized.has(sizedId)) indexes.sized.set(sizedId, flags)
    }
    indexesByProvider.set(providerId, indexes)
    return indexes
}

function normalizeBaseUrl(value?: string | null) {
    return value?.trim().toLowerCase().replace(/\/+$/, '') ?? ''
}

function getHostname(baseUrl: string) {
    try {
        return new URL(baseUrl).hostname
    } catch {
        return ''
    }
}
