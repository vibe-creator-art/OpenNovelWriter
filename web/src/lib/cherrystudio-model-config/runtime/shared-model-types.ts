// Hand-written shim standing in for CherryStudio's `@shared/data/types/model`
// module and the enums it re-exports from `@cherrystudio/provider-registry`.
// Only the members read by the synced files under ../models are defined here;
// zod schemas and registry-loader machinery are intentionally omitted.

export { VENDOR_PATTERNS } from '../models/vendor-patterns'

export const MODALITY = {
    TEXT: 'text',
    IMAGE: 'image',
    AUDIO: 'audio',
    VIDEO: 'video',
    VECTOR: 'vector',
} as const
export type Modality = (typeof MODALITY)[keyof typeof MODALITY]

export const MODEL_CAPABILITY = {
    FUNCTION_CALL: 'function-call',
    REASONING: 'reasoning',
    IMAGE_RECOGNITION: 'image-recognition',
    IMAGE_GENERATION: 'image-generation',
    AUDIO_RECOGNITION: 'audio-recognition',
    AUDIO_GENERATION: 'audio-generation',
    EMBEDDING: 'embedding',
    RERANK: 'rerank',
    AUDIO_TRANSCRIPT: 'audio-transcript',
    VIDEO_RECOGNITION: 'video-recognition',
    VIDEO_GENERATION: 'video-generation',
    STRUCTURED_OUTPUT: 'structured-output',
    FILE_INPUT: 'file-input',
    WEB_SEARCH: 'web-search',
    CODE_EXECUTION: 'code-execution',
    FILE_SEARCH: 'file-search',
    COMPUTER_USE: 'computer-use',
} as const
export type ModelCapability = (typeof MODEL_CAPABILITY)[keyof typeof MODEL_CAPABILITY]

export const UNIQUE_MODEL_ID_SEPARATOR = '::'

export type UniqueModelId = `${string}${typeof UNIQUE_MODEL_ID_SEPARATOR}${string}`

export function parseUniqueModelId(uniqueId: UniqueModelId): {
    providerId: string
    modelId: string
} {
    const idx = uniqueId.indexOf(UNIQUE_MODEL_ID_SEPARATOR)
    if (idx === -1) {
        throw new Error(`Invalid UniqueModelId format: ${uniqueId}`)
    }
    return {
        providerId: uniqueId.slice(0, idx),
        modelId: uniqueId.slice(idx + UNIQUE_MODEL_ID_SEPARATOR.length),
    }
}

export type ThinkingTokenLimits = {
    min?: number
    max?: number
    default?: number
}

export type RuntimeReasoning = {
    type?: string
    thinkingTokenLimits?: ThinkingTokenLimits
    supportedEfforts?: string[]
    defaultEffort?: string
    interleaved?: boolean
}

export type RuntimeParameterSupport = {
    temperature?: { supported: boolean; min: number; max: number; default?: number }
    topP?: { supported: boolean; min: number; max: number; default?: number }
    topK?: { supported: boolean; min: number; max: number }
    frequencyPenalty?: boolean
    presencePenalty?: boolean
    maxTokens?: boolean
    stopSequences?: boolean
    systemMessage?: boolean
}

// Minimal projection of CherryStudio's v2 registry Model — just the fields the
// synced check functions read.
export type Model = {
    id: UniqueModelId
    providerId: string
    apiModelId?: string
    name: string
    group?: string
    capabilities: ModelCapability[]
    inputModalities?: Modality[]
    outputModalities?: Modality[]
    reasoning?: RuntimeReasoning
    parameterSupport?: RuntimeParameterSupport
}
