export type CodexConnectionProviderType = 'openai-official' | 'custom'
export type CodexUpstreamFormat = 'responses' | 'chat-completions'

export type CodexReasoningEffort =
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | 'ultra'

export type CodexChatReasoningConfig = {
    supportsThinking: boolean
    supportsEffort: boolean
    thinkingParam: 'thinking' | 'enable_thinking' | 'none'
    effortParam: 'reasoning_effort' | 'none'
    outputFormat: 'reasoning_content' | 'think-tags'
}

export type CodexProviderModel = {
    id: string
    displayName: string
    contextWindow: number
    supportedReasoningEfforts: CodexReasoningEffort[]
    defaultReasoningEffort: CodexReasoningEffort
    supportsParallelToolCalls: boolean
    inputModalities: Array<'text' | 'image'>
    chatReasoning?: CodexChatReasoningConfig
}

export type CodexCustomProviderSettings = {
    apiKey: string
    baseUrl: string
    upstreamFormat: CodexUpstreamFormat
    defaultModelId: string
    models: CodexProviderModel[]
}

export const DEFAULT_CODEX_CUSTOM_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol'
export const DEFAULT_CODEX_CONTEXT_WINDOW = 300_000

const DEFAULT_SHARED_CONFIG_LINES = [
    `model = "${DEFAULT_CODEX_MODEL}"`,
    'model_context_window = 300000',
    'model_auto_compact_token_limit = 285000',
    'model_reasoning_effort = "high"',
    'disable_response_storage = true',
]

export function getDefaultCodexAuthJson(_providerType: CodexConnectionProviderType = 'openai-official') {
    void _providerType
    return '{}\n'
}

export function getDefaultCodexConfig(_providerType: CodexConnectionProviderType = 'openai-official') {
    void _providerType
    return [...DEFAULT_SHARED_CONFIG_LINES, ''].join('\n')
}

export function createDefaultCodexProviderModel(modelId = DEFAULT_CODEX_MODEL): CodexProviderModel {
    return {
        id: modelId,
        displayName: modelId,
        contextWindow: DEFAULT_CODEX_CONTEXT_WINDOW,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'high',
        supportsParallelToolCalls: true,
        inputModalities: ['text', 'image'],
    }
}

export function getDefaultCodexCustomSettings(): CodexCustomProviderSettings {
    const model = createDefaultCodexProviderModel()
    return {
        apiKey: '',
        baseUrl: DEFAULT_CODEX_CUSTOM_BASE_URL,
        upstreamFormat: 'responses',
        defaultModelId: model.id,
        models: [model],
    }
}

export function parseCodexUpstreamFormat(value: unknown): CodexUpstreamFormat | null {
    return value === 'responses' || value === 'chat-completions' ? value : null
}

export function normalizeCodexProviderModels(value: unknown): CodexProviderModel[] {
    if (!Array.isArray(value)) return []

    const seen = new Set<string>()
    const models: CodexProviderModel[] = []
    for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id.trim() : ''
        if (!id || seen.has(id)) continue

        const contextWindow = Number(record.contextWindow)
        if (!Number.isFinite(contextWindow) || contextWindow <= 0) continue

        const efforts = Array.isArray(record.supportedReasoningEfforts)
            ? record.supportedReasoningEfforts.filter(isCodexReasoningEffort)
            : []
        const defaultReasoningEffort = isCodexReasoningEffort(record.defaultReasoningEffort)
            ? record.defaultReasoningEffort
            : efforts[0] ?? 'high'
        const supportedReasoningEfforts = efforts.includes(defaultReasoningEffort)
            ? efforts
            : [defaultReasoningEffort, ...efforts]
        const inputModalities: Array<'text' | 'image'> = Array.isArray(record.inputModalities)
            ? record.inputModalities.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
            : ['text']

        let chatReasoning: CodexChatReasoningConfig | undefined
        if (record.chatReasoning && typeof record.chatReasoning === 'object') {
            const reasoning = record.chatReasoning as Record<string, unknown>
            chatReasoning = {
                supportsThinking: reasoning.supportsThinking === true,
                supportsEffort: reasoning.supportsEffort === true,
                thinkingParam:
                    reasoning.thinkingParam === 'enable_thinking' || reasoning.thinkingParam === 'none'
                        ? reasoning.thinkingParam
                        : 'thinking',
                effortParam: reasoning.effortParam === 'none' ? 'none' : 'reasoning_effort',
                outputFormat: reasoning.outputFormat === 'think-tags' ? 'think-tags' : 'reasoning_content',
            }
        }

        seen.add(id)
        models.push({
            id,
            displayName:
                typeof record.displayName === 'string' && record.displayName.trim()
                    ? record.displayName.trim()
                    : id,
            contextWindow: Math.floor(contextWindow),
            supportedReasoningEfforts,
            defaultReasoningEffort,
            supportsParallelToolCalls: record.supportsParallelToolCalls === true,
            inputModalities: inputModalities.length > 0 ? [...new Set(inputModalities)] : ['text'],
            ...(chatReasoning ? { chatReasoning } : {}),
        })
    }
    return models
}

export function parseCodexProviderModelsJson(value: string | null | undefined): CodexProviderModel[] {
    try {
        return normalizeCodexProviderModels(JSON.parse(value || '[]'))
    } catch {
        return []
    }
}

export function validateCodexCustomSettings(settings: CodexCustomProviderSettings) {
    const baseUrl = settings.baseUrl.trim().replace(/\/+$/, '')
    if (!baseUrl) throw new Error('Missing Codex upstream base URL.')
    if (!settings.apiKey.trim()) throw new Error('Missing Codex upstream API key.')

    const models = normalizeCodexProviderModels(settings.models)
    if (models.length === 0) throw new Error('Add at least one Codex model.')

    const defaultModelId = settings.defaultModelId.trim()
    if (!models.some((model) => model.id === defaultModelId)) {
        throw new Error('The default Codex model must be present in the model list.')
    }

    return {
        apiKey: settings.apiKey.trim(),
        baseUrl,
        upstreamFormat: settings.upstreamFormat,
        defaultModelId,
        models,
    }
}

function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
    return (
        value === 'none' ||
        value === 'minimal' ||
        value === 'low' ||
        value === 'medium' ||
        value === 'high' ||
        value === 'xhigh' ||
        value === 'max' ||
        value === 'ultra'
    )
}
