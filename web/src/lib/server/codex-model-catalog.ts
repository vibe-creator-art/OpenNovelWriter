import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import type { CodexProviderModel, CodexUpstreamFormat } from '@/lib/codex-config'

export const CODEX_MODEL_CATALOG_FILE = 'opennovelwriter-model-catalog.json'

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
    models: CodexProviderModel[]
}) {
    const template = await loadCodexModelTemplate(input.codexHome)
    const catalog = {
        models: input.models.map((model, index) =>
            buildCatalogEntry(template, model, index, input.upstreamFormat)
        ),
    }
    const target = path.join(input.codexHome, CODEX_MODEL_CATALOG_FILE)
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, target)
    return target
}

function buildCatalogEntry(
    template: JsonObject,
    model: CodexProviderModel,
    index: number,
    upstreamFormat: CodexUpstreamFormat
) {
    const entry: JsonObject = structuredClone(template)
    entry.slug = model.id
    entry.display_name = model.displayName
    entry.description = model.displayName
    entry.context_window = model.contextWindow
    entry.max_context_window = model.contextWindow
    entry.effective_context_window_percent = 95
    entry.priority = 1000 + index
    entry.visibility = 'list'
    entry.supported_in_api = true
    entry.additional_speed_tiers = []
    entry.service_tiers = []
    entry.availability_nux = null
    entry.upgrade = null
    entry.supported_reasoning_levels = model.supportedReasoningEfforts.map((effort) => ({
        effort,
        description: REASONING_DESCRIPTIONS[effort] ?? effort,
    }))
    entry.default_reasoning_level = model.defaultReasoningEffort
    entry.supports_parallel_tool_calls = model.supportsParallelToolCalls
    entry.input_modalities = model.inputModalities
    entry.supports_search_tool = false
    delete entry.web_search_tool_type

    if (upstreamFormat === 'responses') {
        delete entry.apply_patch_tool_type
        delete entry.model_messages
        delete entry.tool_mode
        entry.shell_type = 'shell_command'
        entry.experimental_supported_tools = []
        entry.base_instructions =
            'You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user\'s goals.'
    }

    return entry
}

async function loadCodexModelTemplate(codexHome: string): Promise<JsonObject> {
    const candidates = [
        path.join(codexHome, 'models_cache.json'),
        path.join(os.homedir(), '.codex', 'models_cache.json'),
    ]
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(await fs.readFile(candidate, 'utf8')) as { models?: JsonObject[] }
            const models = Array.isArray(parsed.models) ? parsed.models : []
            const preferred =
                models.find((model) => model.slug === 'gpt-5.6-sol') ??
                models.find((model) => typeof model.base_instructions === 'string')
            if (preferred) return preferred
        } catch {
            // Try the next source. Custom connections may not have a model cache yet.
        }
    }

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
