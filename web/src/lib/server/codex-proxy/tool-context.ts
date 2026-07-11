import crypto from 'crypto'

type JsonObject = Record<string, unknown>

export type CodexToolKind = 'function' | 'namespace' | 'custom' | 'tool_search'

export type CodexToolSpec = {
    kind: CodexToolKind
    name: string
    namespace?: string
}

export class CodexToolContext {
    readonly chatTools: JsonObject[] = []
    private readonly specs = new Map<string, CodexToolSpec>()
    private readonly namespacedNames = new Map<string, string>()

    static fromRequest(body: JsonObject) {
        const context = new CodexToolContext()
        const tools = Array.isArray(body.tools) ? body.tools : []
        for (const tool of tools) context.addResponseTool(tool)
        const input = Array.isArray(body.input) ? body.input : []
        for (const item of input) {
            if (!isObject(item) || item.type !== 'additional_tools' || !Array.isArray(item.tools)) continue
            for (const tool of item.tools) context.addResponseTool(tool)
        }
        collectToolSearchOutputTools(body.input, context)
        return context
    }

    lookup(chatName: string) {
        return this.specs.get(chatName)
    }

    isCustom(chatName: string) {
        return this.lookup(chatName)?.kind === 'custom'
    }

    chatNameFor(name: string, namespace?: string) {
        if (!namespace) return name
        return this.namespacedNames.get(`${namespace}\0${name}`) ?? flattenNamespaceName(namespace, name)
    }

    addResponseTool(value: unknown) {
        if (typeof value === 'string') {
            this.addCustom({ type: 'custom', name: value })
            return
        }
        if (!isObject(value)) return
        if (value.type === 'function') this.addFunction(value)
        else if (value.type === 'custom') this.addCustom(value)
        else if (value.type === 'tool_search') this.addToolSearch()
        else if (value.type === 'namespace') this.addNamespace(value)
    }

    private addFunction(tool: JsonObject, namespace?: string) {
        const name = responseToolName(tool)
        if (!name) return
        const chatName = namespace ? flattenNamespaceName(namespace, name) : name
        const nested = isObject(tool.function) ? tool.function : null
        const parameters = nested?.parameters ?? tool.parameters ?? {}
        const description = nested?.description ?? tool.description ?? ''
        const chatTool: JsonObject = {
            type: 'function',
            function: {
                name: chatName,
                description,
                parameters,
                ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
            },
        }
        this.add(chatName, {
            kind: namespace ? 'namespace' : 'function',
            name,
            ...(namespace ? { namespace } : {}),
        }, chatTool)
    }

    private addCustom(tool: JsonObject) {
        const name = responseToolName(tool)
        if (!name) return
        this.add(name, { kind: 'custom', name }, {
            type: 'function',
            function: {
                name,
                description: `Original custom tool definition:\n${JSON.stringify(tool)}`,
                parameters: {
                    type: 'object',
                    properties: {
                        input: {
                            type: 'string',
                            description: 'Raw string input for the original custom tool.',
                        },
                    },
                    required: ['input'],
                },
            },
        })
    }

    private addToolSearch() {
        this.add('tool_search', { kind: 'tool_search', name: 'tool_search' }, {
            type: 'function',
            function: {
                name: 'tool_search',
                description: 'Search and load Codex tools, plugins, connectors, and MCP namespaces.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string' },
                        limit: { type: 'integer' },
                    },
                    required: ['query'],
                },
            },
        })
    }

    private addNamespace(tool: JsonObject) {
        const namespace = typeof tool.name === 'string' ? tool.name.trim() : ''
        if (!namespace) return
        const children = Array.isArray(tool.tools)
            ? tool.tools
            : Array.isArray(tool.children)
              ? tool.children
              : []
        for (const child of children) {
            if (isObject(child) && child.type === 'function') this.addFunction(child, namespace)
        }
    }

    private add(chatName: string, spec: CodexToolSpec, tool: JsonObject) {
        if (!chatName || this.specs.has(chatName)) return
        this.specs.set(chatName, spec)
        if (spec.namespace) this.namespacedNames.set(`${spec.namespace}\0${spec.name}`, chatName)
        this.chatTools.push(tool)
    }
}

export function normalizeCodexResponsesTools(body: JsonObject) {
    const input = Array.isArray(body.input) ? body.input : null
    if (!input) return body

    const extractedTools: unknown[] = []
    const normalizedInput: unknown[] = []
    for (const item of input) {
        if (isObject(item) && item.type === 'additional_tools' && Array.isArray(item.tools)) {
            for (const tool of item.tools) extractedTools.push(...flattenResponseTool(tool))
        } else {
            normalizedInput.push(normalizeResponseInputItem(item))
        }
    }
    if (extractedTools.length === 0) return body

    const existingTools = Array.isArray(body.tools) ? body.tools : []
    const toolChoice = isObject(body.tool_choice) && body.tool_choice.type === 'function'
        ? normalizeResponseInputItem(body.tool_choice)
        : body.tool_choice
    return {
        ...body,
        input: normalizedInput,
        tools: [...existingTools, ...extractedTools],
        ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
    }
}

export function rewriteNamespacedResponse(value: unknown, context: CodexToolContext): unknown {
    if (Array.isArray(value)) return value.map((item) => rewriteNamespacedResponse(item, context))
    if (!isObject(value)) return value

    let result: JsonObject = value
    if (value.type === 'function_call' && typeof value.name === 'string') {
        const spec = context.lookup(value.name)
        if (spec?.namespace) {
            result = { ...value, name: spec.name, namespace: spec.namespace }
        }
    }
    if (isObject(result.item)) {
        result = { ...result, item: rewriteNamespacedResponse(result.item, context) }
    }
    if (isObject(result.response)) {
        result = { ...result, response: rewriteNamespacedResponse(result.response, context) }
    }
    if (Array.isArray(result.output)) {
        result = { ...result, output: result.output.map((item) => rewriteNamespacedResponse(item, context)) }
    }
    return result
}

export function responseItemFromChatToolCall(input: {
    callId: string
    chatName: string
    arguments: string
    status: 'in_progress' | 'completed'
    context: CodexToolContext
    reasoning?: string
}) {
    const spec = input.context.lookup(input.chatName)
    if (spec?.kind === 'tool_search') {
        return withReasoning({
            type: 'tool_search_call',
            call_id: input.callId,
            status: input.status,
            execution: 'client',
            arguments: parseArgumentsObject(input.arguments),
        }, input.reasoning)
    }
    if (spec?.kind === 'custom') {
        return withReasoning({
            id: `ctc_${input.callId}`,
            type: 'custom_tool_call',
            status: input.status,
            call_id: input.callId,
            name: spec.name,
            input: customInput(input.arguments),
        }, input.reasoning)
    }
    return withReasoning({
        id: `fc_${input.callId}`,
        type: 'function_call',
        status: input.status,
        call_id: input.callId,
        name: spec?.name ?? input.chatName,
        ...(spec?.namespace ? { namespace: spec.namespace } : {}),
        arguments: canonicalArguments(input.arguments),
    }, input.reasoning)
}

export function responseItemId(callId: string, chatName: string, context: CodexToolContext) {
    return context.isCustom(chatName) ? `ctc_${callId}` : `fc_${callId}`
}

export function customInput(argumentsValue: string) {
    try {
        const parsed = JSON.parse(argumentsValue) as unknown
        if (isObject(parsed) && typeof parsed.input === 'string') return parsed.input
    } catch {
        // Use the raw argument string.
    }
    return argumentsValue
}

export function canonicalArguments(value: unknown) {
    if (typeof value === 'string') {
        try {
            return JSON.stringify(JSON.parse(value))
        } catch {
            return value
        }
    }
    return JSON.stringify(value ?? {})
}

function collectToolSearchOutputTools(value: unknown, context: CodexToolContext) {
    if (Array.isArray(value)) {
        for (const item of value) collectToolSearchOutputTools(item, context)
        return
    }
    if (!isObject(value)) return
    if (value.type === 'tool_search_output' && Array.isArray(value.tools)) {
        for (const tool of value.tools) context.addResponseTool(tool)
    }
    for (const child of Object.values(value)) collectToolSearchOutputTools(child, context)
}

function responseToolName(tool: JsonObject) {
    const nested = isObject(tool.function) ? tool.function.name : null
    const value = typeof nested === 'string' ? nested : tool.name
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function flattenNamespaceName(namespace: string, name: string) {
    const full = `${namespace}__${name}`
    if (full.length <= 64) return full
    const hash = crypto.createHash('sha256').update(full).digest('hex').slice(0, 12)
    return `${full.slice(0, 50)}__${hash}`
}

function flattenResponseTool(value: unknown): unknown[] {
    if (!isObject(value) || value.type !== 'namespace') return [value]
    const namespace = typeof value.name === 'string' ? value.name.trim() : ''
    const children = Array.isArray(value.tools) ? value.tools : Array.isArray(value.children) ? value.children : []
    if (!namespace) return []
    return children
        .filter(isObject)
        .filter((child) => child.type === 'function' && typeof child.name === 'string')
        .map((child) => ({ ...child, name: flattenNamespaceName(namespace, String(child.name)) }))
}

function normalizeResponseInputItem(value: unknown) {
    if (!isObject(value) || value.type !== 'function_call') return value
    const namespace = typeof value.namespace === 'string' ? value.namespace.trim() : ''
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    if (!namespace || !name) return value
    const { namespace: _namespace, ...rest } = value
    void _namespace
    return { ...rest, name: flattenNamespaceName(namespace, name) }
}

function parseArgumentsObject(value: string) {
    try {
        const parsed = JSON.parse(value) as unknown
        return isObject(parsed) ? parsed : { query: value }
    } catch {
        return value ? { query: value } : {}
    }
}

function withReasoning<T extends JsonObject>(item: T, reasoning?: string) {
    return reasoning?.trim() ? { ...item, reasoning_content: reasoning.trim() } : item
}

export function isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
