import { toSharedCompatModel } from './models/bridge'
import {
    isEmbeddingModel,
    isFunctionCallingModel,
    isGenerateImageModel,
    isReasoningModel,
    isRerankModel,
    isTextToImageModel,
    isVisionModel,
} from './models/model'
import { normalizeModelId } from './models/normalize'
import { REGISTRY_FLAG, REGISTRY_MODEL_FLAGS } from './models/registry-capabilities'

export { getModelLogoById as getCherryStudioModelLogoById } from './logo'

export type CherryStudioModelType =
    | 'vision'
    | 'reasoning'
    | 'tool'
    | 'reranker'
    | 'embedding'

export type CherryStudioDetectionState = Record<CherryStudioModelType, boolean>

export type CherryStudioDetectionInput = {
    modelId: string
    modelName?: string | null
    providerId?: string | null
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
    const flags = lookupRegistryFlags(input.modelId)
    if (flags === undefined) {
        return inferDetection(input)
    }

    return {
        vision: (flags & REGISTRY_FLAG.vision) !== 0,
        reasoning: (flags & REGISTRY_FLAG.reasoning) !== 0,
        tool: (flags & REGISTRY_FLAG.tool) !== 0,
        reranker: (flags & REGISTRY_FLAG.reranker) !== 0,
        embedding: (flags & REGISTRY_FLAG.embedding) !== 0,
    }
}

/**
 * Any image-output capable model, per the registry catalog or, for uncataloged
 * ids, the synced upstream inference.
 */
export function isImageGenerationModel(input: CherryStudioDetectionInput): boolean {
    const flags = lookupRegistryFlags(input.modelId)
    if (flags !== undefined) {
        return (flags & REGISTRY_FLAG.imageGeneration) !== 0
    }

    return isGenerateImageModel(toDetectionModel(input))
}

/**
 * Dedicated text-to-image model (gpt-image, dall-e, flux, …) that cannot chat —
 * image generation without reasoning, the upstream `isTextToImageModel`
 * semantics. Chat-capable image-output models (gemini image) are excluded.
 */
export function isDedicatedImageGenerationModel(input: CherryStudioDetectionInput): boolean {
    const flags = lookupRegistryFlags(input.modelId)
    if (flags !== undefined) {
        return (flags & REGISTRY_FLAG.imageGeneration) !== 0 && (flags & REGISTRY_FLAG.reasoning) === 0
    }

    return isTextToImageModel(toDetectionModel(input))
}

function toDetectionModel(input: CherryStudioDetectionInput) {
    return toSharedCompatModel({
        id: input.modelId,
        name: input.modelName?.trim() || input.modelId,
        provider: resolveProviderId(input),
    })
}

// CherryStudio registry catalog lookup. Mirrors RegistryLoader semantics:
// exact id match first, then the normalized-id index.
function lookupRegistryFlags(modelId: string): number | undefined {
    return REGISTRY_MODEL_FLAGS[modelId] ?? getNormalizedRegistryIndex().get(normalizeModelId(modelId))
}

let normalizedRegistryIndex: Map<string, number> | undefined

function getNormalizedRegistryIndex(): Map<string, number> {
    if (!normalizedRegistryIndex) {
        normalizedRegistryIndex = new Map()
        for (const [id, flags] of Object.entries(REGISTRY_MODEL_FLAGS)) {
            const normalized = normalizeModelId(id)
            if (!normalizedRegistryIndex.has(normalized)) {
                normalizedRegistryIndex.set(normalized, flags)
            }
        }
    }
    return normalizedRegistryIndex
}

// Fallback for models missing from the registry catalog: the synced bridge
// infers a capability list from the model id, then the synced checks read it.
function inferDetection(input: CherryStudioDetectionInput): CherryStudioDetectionState {
    const shared = toDetectionModel(input)

    return {
        vision: isVisionModel(shared),
        reasoning: isReasoningModel(shared),
        tool: isFunctionCallingModel(shared),
        reranker: isRerankModel(shared),
        embedding: isEmbeddingModel(shared),
    }
}

function resolveProviderId(input: CherryStudioDetectionInput) {
    if (input.providerId?.trim()) {
        return input.providerId.trim()
    }

    const baseUrl = (input.baseUrl ?? '').toLocaleLowerCase()

    if (baseUrl.includes('openrouter.ai')) return 'openrouter'
    if (baseUrl.includes('perplexity.ai')) return 'perplexity'
    if (baseUrl.includes('anthropic.com')) return 'anthropic'
    if (baseUrl.includes('x.ai')) return 'grok'
    if (baseUrl.includes('volces.com') || baseUrl.includes('volcengine.com')) return 'doubao'
    if (baseUrl.includes('dashscope.aliyuncs.com')) return 'dashscope'
    if (baseUrl.includes('bigmodel.cn')) return 'zhipu'
    if (baseUrl.includes('hunyuan.tencentcloudapi.com')) return 'hunyuan'
    if (baseUrl.includes('generativelanguage.googleapis.com')) return 'gemini'
    if (baseUrl.includes('aiplatform.googleapis.com')) return 'vertexai'
    if (baseUrl.includes('azure.com')) return 'openai'

    return 'openai'
}
