import path from 'path'

import {
    getCustomCodexServiceTiers,
    isGptCodexModelId,
    type CodexProviderModel,
    type CodexUpstreamFormat,
} from '@/lib/codex-config'
import {
    applyCodexUpstreamModelCapabilities,
    buildOfficialDeepSeekCatalogEntry,
    isOfficialDeepSeekAnthropicProvider,
    shouldUseOfficialDeepSeekCatalog,
} from '@/lib/codex-deepseek'
import { writeFileAtomicallyIfChanged } from '@/lib/server/atomic-file-write'
import { findCodexNativeModel, readCodexNativeModels, resolveCodexProviderModels, type CodexNativeModel } from './codex-native-models'

export const CODEX_MODEL_CATALOG_FILE = 'opennovelwriter-model-catalog.json'

const CUSTOM_MODEL_BASE_INSTRUCTIONS =
    'You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user\'s goals.'

type JsonObject = Record<string, unknown>

const REASONING_DESCRIPTIONS: Record<string, string> = {
    none: 'Disable thinking',
    minimal: 'Minimal reasoning',
    low: 'Fast responses with lighter reasoning',
    medium: 'Balanced reasoning depth',
    high: 'Greater reasoning depth for complex tasks',
    xhigh: 'Extra high reasoning depth',
    max: 'Maximum reasoning depth',
    ultra: 'Maximum reasoning with automatic delegation',
}

export async function writeCodexModelCatalog(input: {
    codexHome: string
    upstreamFormat: CodexUpstreamFormat
    baseUrl?: string | null
    models: CodexProviderModel[]
}) {
    const gptIds = input.models.filter((model) => isGptCodexModelId(model.id)).map((model) => model.id)
    const nativeModels = gptIds.length > 0 ? await readCodexNativeModels(input.codexHome, gptIds) : []
    const models = resolveCodexProviderModels(input.models, nativeModels, input.baseUrl)
    const catalog = {
        models: models.map((model, index) =>
            buildCatalogEntry(nativeModels, model, index, input.upstreamFormat, input.baseUrl)
        ),
    }
    const target = path.join(input.codexHome, CODEX_MODEL_CATALOG_FILE)
    await writeFileAtomicallyIfChanged(target, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 })
    return target
}

function buildCatalogEntry(
    nativeModels: CodexNativeModel[],
    model: CodexProviderModel,
    index: number,
    upstreamFormat: CodexUpstreamFormat,
    baseUrl?: string | null
) {
    if (isGptCodexModelId(model.id)) {
        const native = findCodexNativeModel(nativeModels, model.id)
        if (!native) throw new Error(`Codex model ${model.id} is unavailable.`)
        return { ...structuredClone(native), slug: model.id }
    }
    model = applyCodexUpstreamModelCapabilities(model, upstreamFormat, baseUrl)
    if (shouldUseOfficialDeepSeekCatalog(upstreamFormat, baseUrl, model.id)) {
        return applyCustomServiceTiers(buildOfficialDeepSeekCatalogEntry(model, index), upstreamFormat)
    }

    const entry: JsonObject = customModelTemplate()
    entry.slug = model.id
    entry.display_name = model.displayName
    entry.description = model.displayName
    entry.base_instructions = CUSTOM_MODEL_BASE_INSTRUCTIONS
    entry.context_window = model.contextWindow
    entry.max_context_window = model.contextWindow
    entry.effective_context_window_percent = 95
    entry.priority = 1000 + index
    entry.visibility = 'list'
    entry.supported_in_api = true
    entry.additional_speed_tiers = []
    entry.service_tiers = getCustomCodexServiceTiers(upstreamFormat)
    entry.availability_nux = null
    entry.upgrade = null
    entry.supported_reasoning_levels = model.supportedReasoningEfforts.map((effort) => ({
        effort,
        description: REASONING_DESCRIPTIONS[effort] ?? effort,
    }))
    entry.default_reasoning_level = model.defaultReasoningEffort
    entry.supports_parallel_tool_calls = model.supportsParallelToolCalls
    entry.input_modalities = model.inputModalities
    // Third-party models use Codex's deferred tool registry. The proxy bridges
    // tool_search to ordinary function calling when the upstream does not
    // implement Codex's client-executed search item natively.
    entry.supports_search_tool = true
    delete entry.tool_mode
    entry.use_responses_lite = false
    delete entry.web_search_tool_type
    if (isOfficialDeepSeekAnthropicProvider(upstreamFormat, baseUrl)) entry.web_search_tool_type = 'text'

    if (upstreamFormat === 'responses' || upstreamFormat === 'anthropic-messages') {
        delete entry.apply_patch_tool_type
        delete entry.model_messages
        entry.shell_type = 'shell_command'
        entry.experimental_supported_tools = []
    }

    return entry
}

function applyCustomServiceTiers(entry: JsonObject, upstreamFormat: CodexUpstreamFormat) {
    entry.additional_speed_tiers = []
    entry.service_tiers = getCustomCodexServiceTiers(upstreamFormat)
    return entry
}

function customModelTemplate(): JsonObject {
    return {
        slug: 'opennovelwriter-template',
        display_name: 'OpenNovelWriter template',
        description: 'OpenNovelWriter template',
        base_instructions:
            'You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user\'s goals.',
        model_messages: {
            instructions_template: '{base_instructions}',
            instructions_variables: {},
            approvals: {},
        },
        default_reasoning_level: 'high',
        supported_reasoning_levels: [{ effort: 'high', description: 'Enabled thinking' }],
        shell_type: 'shell_command',
        apply_patch_tool_type: 'freeform',
        visibility: 'list',
        supported_in_api: true,
        priority: 0,
        supports_reasoning_summaries: true,
        default_reasoning_summary: 'none',
        support_verbosity: false,
        truncation_policy: { mode: 'bytes', limit: 10000 },
        supports_parallel_tool_calls: false,
        supports_image_detail_original: false,
        context_window: 128000,
        max_context_window: 128000,
        effective_context_window_percent: 95,
        experimental_supported_tools: [],
        input_modalities: ['text'],
        supports_search_tool: false,
    }
}
