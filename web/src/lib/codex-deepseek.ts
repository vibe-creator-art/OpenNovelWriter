import type { CodexProviderModel, CodexReasoningEffort, CodexUpstreamFormat } from '@/lib/codex-config'
import deepSeekOfficialCatalog from '@/lib/codex-deepseek-official-catalog.json'

/** DeepSeek capability defaults support official and provider-prefixed model IDs. */
export const DEEPSEEK_MODEL_SLUG_PATTERN = /^deepseek-(?:flash|v4(?:\.1)?-flash|v4-pro)$/i
export const DEEPSEEK_OFFICIAL_CONTEXT_WINDOW = 1_048_576
export const DEEPSEEK_OFFICIAL_REASONING_EFFORTS: CodexReasoningEffort[] = ['low', 'high', 'max']
export const DEEPSEEK_OFFICIAL_DEFAULT_REASONING_EFFORT: CodexReasoningEffort = 'high'

type JsonObject = Record<string, unknown>

/**
 * Normalize aggregator model ids to the bare DeepSeek slug.
 * `deepseek/deepseek-v4-flash` → `deepseek-v4-flash`
 * `deepseek-v4-flash:baidu` → `deepseek-v4-flash`
 * `deepseek/deepseek-v4-pro:nitro` → `deepseek-v4-pro`
 */
export function baseDeepSeekModelSlug(modelId: string) {
    const trimmed = modelId.trim()
    if (!trimmed) return ''
    const withoutProvider = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed
    const withoutRouter = withoutProvider.includes(':')
        ? withoutProvider.slice(0, withoutProvider.indexOf(':'))
        : withoutProvider
    return withoutRouter.trim().toLowerCase()
}

export function isDeepSeekModelId(modelId: string) {
    return DEEPSEEK_MODEL_SLUG_PATTERN.test(baseDeepSeekModelSlug(modelId))
}

export function isDeepSeekOfficialHost(baseUrl?: string | null) {
    if (!baseUrl) return false
    try {
        const hostname = new URL(baseUrl).hostname.toLowerCase()
        return hostname === 'deepseek.com' || hostname.endsWith('.deepseek.com')
    } catch {
        return false
    }
}

export function isOfficialDeepSeekResponsesProvider(
    upstreamFormat: CodexUpstreamFormat,
    baseUrl?: string | null
) {
    return upstreamFormat === 'responses' && isDeepSeekOfficialHost(baseUrl)
}

export function isOfficialDeepSeekAnthropicProvider(
    upstreamFormat: CodexUpstreamFormat,
    baseUrl?: string | null
) {
    return upstreamFormat === 'anthropic-messages' && isDeepSeekOfficialHost(baseUrl)
}

/** Apply DeepSeek context, reasoning, and input capabilities by model ID. */
export function applyDeepSeekModelDefaults(model: CodexProviderModel): CodexProviderModel {
    if (!isDeepSeekModelId(model.id)) return model
    return {
        ...model,
        contextWindow: DEEPSEEK_OFFICIAL_CONTEXT_WINDOW,
        supportedReasoningEfforts: [...DEEPSEEK_OFFICIAL_REASONING_EFFORTS],
        defaultReasoningEffort: DEEPSEEK_OFFICIAL_DEFAULT_REASONING_EFFORT,
        supportsParallelToolCalls: true,
        inputModalities: baseDeepSeekModelSlug(model.id) === 'deepseek-v4-pro' ? ['text'] : ['text', 'image'],
    }
}

/** Apply model capability defaults to custom Codex connections. */
export function applyCodexUpstreamModelCapabilities(
    model: CodexProviderModel,
    _upstreamFormat?: CodexUpstreamFormat,
    _baseUrl?: string | null
): CodexProviderModel {
    void _upstreamFormat
    void _baseUrl
    return applyDeepSeekModelDefaults(model)
}

/**
 * Only the official DeepSeek Responses host gets the vendor catalog (freeform
 * apply_patch + harness). Aggregators keep the neutral template after model
 * defaults are applied above.
 */
export function shouldUseOfficialDeepSeekCatalog(
    upstreamFormat: CodexUpstreamFormat,
    baseUrl: string | null | undefined,
    modelId: string
) {
    return isOfficialDeepSeekResponsesProvider(upstreamFormat, baseUrl) && isDeepSeekModelId(modelId)
}

/**
 * Build a catalog entry from DeepSeek's official Codex models.json template.
 * Keep tool search enabled; the proxy presents it as ordinary function calling
 * while preserving Codex's deferred MCP tool registry.
 */
export function buildOfficialDeepSeekCatalogEntry(model: CodexProviderModel, index: number): JsonObject {
    const officialModels = (deepSeekOfficialCatalog.models ?? []) as JsonObject[]
    const slug = baseDeepSeekModelSlug(model.id)
    const matched = officialModels.find((entry) => (
        typeof entry.slug === 'string' && entry.slug.toLowerCase() === slug
    ))
    const entry: JsonObject = structuredClone(matched ?? officialModels[0] ?? {})
    if (!matched) {
        entry.slug = model.id
        entry.description = model.displayName
        entry.priority = 1000 + index
    } else {
        // Keep the connection's configured model id (may include provider prefix).
        entry.slug = model.id
    }
    entry.display_name = model.displayName
    entry.context_window = model.contextWindow
    entry.max_context_window = model.contextWindow
    entry.supports_parallel_tool_calls = model.supportsParallelToolCalls
    entry.input_modalities = model.inputModalities
    entry.supports_search_tool = true
    return entry
}
