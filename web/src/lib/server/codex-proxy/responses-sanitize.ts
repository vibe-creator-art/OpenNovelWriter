import { isObject } from '@/lib/server/codex-proxy/tool-context'

type JsonObject = Record<string, unknown>

/**
 * Fields Codex attaches for the ChatGPT backend that strict third-party
 * Responses gateways (ZenMux, xAI, DeepSeek aggregators, …) often reject or
 * mishandle when they convert Responses → Chat for non-OpenAI models.
 */
const TOP_LEVEL_PRIVATE_FIELDS = [
    'prompt_cache_retention',
    'safety_identifier',
    'external_web_access',
] as const

/**
 * Tool types safe to forward. Everything else is a Codex/OpenAI private carrier
 * (`tool_search`, residual `namespace`, freeform `custom`, …) that frequently
 * breaks gateway-side Responses→Chat converters with confusing 400s such as
 * "missing messages.content".
 */
const SUPPORTED_TOOL_TYPES = new Set([
    'function',
    'web_search',
    'file_search',
    'code_interpreter',
    'code_execution',
    'mcp',
    'shell',
    'image_generation',
])

/**
 * Sanitize a Codex Responses request for third-party native Responses upstreams.
 * Runs after {@link normalizeCodexResponsesTools} so namespaces are already flat.
 */
export function sanitizeThirdPartyResponsesRequest(body: JsonObject): JsonObject {
    let result: JsonObject = { ...body }
    let changed = false

    for (const field of TOP_LEVEL_PRIVATE_FIELDS) {
        if (field in result) {
            const { [field]: _removed, ...rest } = result
            void _removed
            result = rest
            changed = true
        }
    }

    if (Array.isArray(result.tools)) {
        const originalTools = result.tools
        const tools = originalTools
            .map((tool) => normalizeTool(tool))
            .filter((tool): tool is JsonObject => tool !== null)
        if (tools.length !== originalTools.length || tools.some((tool, index) => tool !== originalTools[index])) {
            result = { ...result, tools }
            changed = true
        }
        if (tools.length === 0) {
            if ('tools' in result) {
                const { tools: _tools, tool_choice: _choice, ...rest } = result
                void _tools
                void _choice
                result = rest
                changed = true
            }
        } else if (isObject(result.tool_choice) && result.tool_choice.type === 'function') {
            const choiceName = typeof result.tool_choice.name === 'string' ? result.tool_choice.name : ''
            const stillPresent = tools.some((tool) => toolName(tool) === choiceName)
            if (choiceName && !stillPresent) {
                result = { ...result, tool_choice: 'auto' }
                changed = true
            }
        }
    }

    if (Array.isArray(result.input)) {
        const originalInput = result.input
        const input = originalInput
            .map((item) => sanitizeInputItem(item))
            .filter((item) => item !== null)
        if (input.length !== originalInput.length || input.some((item, index) => item !== originalInput[index])) {
            result = { ...result, input }
            changed = true
        }
    }

    return changed ? result : body
}

function normalizeTool(value: unknown): JsonObject | null {
    if (!isObject(value)) return null
    const type = typeof value.type === 'string' ? value.type.trim() : ''
    if (!type || !SUPPORTED_TOOL_TYPES.has(type)) return null
    if (type !== 'function') return value

    // Responses function tools are usually flat `{type,name,parameters}`; some
    // gateways also accept the nested Chat shape. Normalize parameters either way.
    if (isObject(value.function)) {
        const fn = value.function
        return {
            ...value,
            function: {
                ...fn,
                parameters: normalizeFunctionParameters(fn.parameters),
            },
        }
    }
    return {
        ...value,
        parameters: normalizeFunctionParameters(value.parameters),
    }
}

/**
 * Strict OpenAI-compatible / Chinese gateways reject `parameters: null` and
 * `parameters: { type: null }`. Always emit a real object schema.
 */
export function normalizeFunctionParameters(value: unknown): JsonObject {
    const params = isObject(value) ? { ...value } : {}
    if (params.type !== 'object') params.type = 'object'
    if (!isObject(params.properties)) params.properties = isObject(params.properties) ? params.properties : {}
    return params
}

function sanitizeInputItem(value: unknown): unknown | null {
    if (!isObject(value)) return value

    // Drop unfinished calls — replaying them confuses gateway converters.
    if (
        value.status === 'incomplete'
        && (value.type === 'function_call' || value.type === 'custom_tool_call' || value.type === 'tool_search_call')
    ) {
        return null
    }

    // xAI / strict serde: present-but-null `content` on reasoning items fails.
    if (value.type === 'reasoning' && value.content === null) {
        const { content: _content, ...rest } = value
        void _content
        return rest
    }

    return value
}

function toolName(tool: JsonObject) {
    if (typeof tool.name === 'string' && tool.name.trim()) return tool.name.trim()
    if (isObject(tool.function) && typeof tool.function.name === 'string') return tool.function.name.trim()
    return ''
}
