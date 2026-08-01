import crypto from 'node:crypto'

import {
    canonicalArguments,
    CodexToolContext,
    isObject,
    responseItemFromChatToolCall,
} from './tool-context'

type JsonObject = Record<string, unknown>

const ANTHROPIC_THINKING_PREFIX = 'opennovelwriter-anthropic-thinking-v1:'
const DEFAULT_MAX_TOKENS = 8192

export function responsesToAnthropicRequest(body: JsonObject, context: CodexToolContext) {
    const messages = responsesInputToAnthropicMessages(body.input, context)
    if (messages.length === 0) throw new Error('Cannot convert an empty Responses request to Anthropic Messages.')
    if (messages[0].role !== 'user') {
        messages.unshift({ role: 'user', content: [{ type: 'text', text: '(continuing the conversation)' }] })
    }

    const result: JsonObject = {
        model: stringValue(body.model),
        messages,
        max_tokens: positiveInteger(body.max_output_tokens) || positiveInteger(body.max_tokens) || DEFAULT_MAX_TOKENS,
        stream: body.stream === true,
    }

    const system = anthropicSystem(body)
    if (system) result.system = system

    const tools = context.chatTools.map(chatToolToAnthropic).filter((tool) => tool !== null)
    if (tools.length > 0) {
        result.tools = tools
        const choice = anthropicToolChoice(body.tool_choice, context)
        if (choice) result.tool_choice = choice
        if (body.parallel_tool_calls === false) {
            const toolChoice = isObject(result.tool_choice) ? result.tool_choice : { type: 'auto' }
            result.tool_choice = { ...toolChoice, disable_parallel_tool_use: true }
        }
    }

    const effort = isObject(body.reasoning) ? stringValue(body.reasoning.effort).toLowerCase() : ''
    const budget = anthropicThinkingBudget(effort, result.max_tokens as number)
    const forcedTool = isObject(result.tool_choice)
        && (result.tool_choice.type === 'any' || result.tool_choice.type === 'tool')
    if (budget > 0 && !forcedTool && trailingTurnSupportsThinking(messages)) {
        result.thinking = { type: 'enabled', budget_tokens: budget }
    } else {
        if (body.temperature !== undefined) result.temperature = body.temperature
        if (body.top_p !== undefined) result.top_p = body.top_p
    }

    return result
}

export function anthropicResponseToResponses(body: JsonObject, context: CodexToolContext) {
    if (body.type === 'error' || isObject(body.error)) {
        const error = isObject(body.error) ? body.error : body
        throw new Error(stringValue(error.message) || 'Anthropic upstream returned an error.')
    }

    const responseId = responseIdFromAnthropic(body.id)
    const output: JsonObject[] = []
    let textParts: JsonObject[] = []
    const flushText = () => {
        if (textParts.length === 0) return
        output.push({
            id: `${responseId}_msg_${output.length}`,
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: textParts,
        })
        textParts = []
    }

    const blocks = Array.isArray(body.content) ? body.content : []
    for (const value of blocks) {
        if (!isObject(value)) continue
        if (value.type === 'text') {
            const text = stringValue(value.text)
            if (text) textParts.push({ type: 'output_text', text, annotations: [] })
            continue
        }
        flushText()
        if (value.type === 'tool_use') {
            const callId = stringValue(value.id) || `call_${crypto.randomUUID()}`
            const name = stringValue(value.name)
            if (!name) continue
            output.push(responseItemFromChatToolCall({
                callId,
                chatName: name,
                arguments: canonicalArguments(value.input),
                status: 'completed',
                context,
            }))
        } else if (value.type === 'thinking' || value.type === 'redacted_thinking') {
            const reasoning = reasoningItemFromAnthropicBlock(`${responseId}_${output.length}`, value)
            if (reasoning) output.push(reasoning)
        }
    }
    flushText()

    const { status, reason } = responsesStatusFromAnthropic(body.stop_reason)
    return {
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status,
        model: stringValue(body.model),
        output,
        usage: anthropicUsageToResponses(body.usage),
        ...(reason ? { incomplete_details: { reason } } : {}),
    }
}

export function anthropicUsageToResponses(value: unknown) {
    const usage = isObject(value) ? value : {}
    const freshInput = positiveInteger(usage.input_tokens)
    const cacheRead = positiveInteger(usage.cache_read_input_tokens)
    const cacheWrite = positiveInteger(usage.cache_creation_input_tokens)
    const input = freshInput + cacheRead + cacheWrite
    const output = positiveInteger(usage.output_tokens)
    const result: JsonObject = {
        input_tokens: input,
        output_tokens: output,
        total_tokens: input + output,
        output_tokens_details: { reasoning_tokens: 0 },
    }
    if (cacheRead > 0 || cacheWrite > 0) {
        result.input_tokens_details = { cached_tokens: cacheRead, cache_write_tokens: cacheWrite }
    }
    return result
}

export function responsesStatusFromAnthropic(value: unknown) {
    const reason = stringValue(value)
    if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') {
        return { status: 'incomplete', reason: 'max_output_tokens' }
    }
    if (reason === 'refusal') return { status: 'incomplete', reason: 'content_filter' }
    return { status: 'completed', reason: '' }
}

export function responseIdFromAnthropic(value: unknown) {
    const id = stringValue(value) || crypto.randomUUID()
    return id.startsWith('resp_') ? id : `resp_${id}`
}

export function reasoningItemFromAnthropicBlock(id: string, block: JsonObject) {
    const encryptedContent = encodeAnthropicThinkingBlock(block)
    if (!encryptedContent) return null
    const thinking = stringValue(block.thinking)
    return {
        id: `rs_${id}`,
        type: 'reasoning',
        summary: thinking ? [{ type: 'summary_text', text: thinking }] : [],
        encrypted_content: encryptedContent,
    }
}

function anthropicSystem(body: JsonObject) {
    const parts: string[] = []
    const instructions = stringValue(body.instructions).trim()
    if (instructions) parts.push(instructions)
    const input = Array.isArray(body.input) ? body.input : []
    for (const item of input) {
        if (!isObject(item) || (item.role !== 'system' && item.role !== 'developer')) continue
        parts.push(...textParts(item.content))
    }
    return parts.filter(Boolean).join('\n\n')
}

function responsesInputToAnthropicMessages(value: unknown, context: CodexToolContext) {
    const messages: JsonObject[] = []
    const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : isObject(value) ? [value] : []

    for (const item of items) {
        if (typeof item === 'string') {
            if (item.trim()) pushBlock(messages, 'user', { type: 'text', text: item })
            continue
        }
        if (!isObject(item) || item.type === 'additional_tools') continue
        if (item.status === 'incomplete' && isCallType(item.type)) continue

        if (item.type === 'function_call') {
            const name = stringValue(item.name)
            const input = parseArguments(item.arguments, name)
            pushBlock(messages, 'assistant', {
                type: 'tool_use',
                id: stringValue(item.call_id) || stringValue(item.id),
                name: context.chatNameFor(name, stringValue(item.namespace) || undefined),
                input,
            })
            continue
        }
        if (item.type === 'custom_tool_call') {
            pushBlock(messages, 'assistant', {
                type: 'tool_use',
                id: stringValue(item.call_id) || stringValue(item.id),
                name: stringValue(item.name),
                input: { input: item.input ?? '' },
            })
            continue
        }
        if (item.type === 'tool_search_call') {
            pushBlock(messages, 'assistant', {
                type: 'tool_use',
                id: stringValue(item.call_id) || stringValue(item.id),
                name: 'tool_search',
                input: isObject(item.arguments) ? item.arguments : parseArguments(item.arguments, 'tool_search'),
            })
            continue
        }
        if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output' || item.type === 'tool_search_output') {
            pushToolResult(messages, {
                type: 'tool_result',
                tool_use_id: stringValue(item.call_id),
                content: anthropicToolResult(item.output),
            })
            continue
        }
        if (item.type === 'reasoning') {
            const block = decodeAnthropicThinkingBlock(stringValue(item.encrypted_content))
            if (block) pushBlock(messages, 'assistant', block, true)
            continue
        }
        if (item.type === 'input_text') {
            const text = stringValue(item.text)
            if (text.trim()) pushBlock(messages, 'user', { type: 'text', text })
            continue
        }
        if (item.type === 'input_image') {
            const block = inputImageToAnthropic(item)
            if (block) pushBlock(messages, 'user', block)
            continue
        }

        const role = item.role === 'assistant' ? 'assistant' : item.role === 'system' || item.role === 'developer' ? null : 'user'
        if (!role) continue
        for (const block of responseContentToAnthropic(item.content)) pushBlock(messages, role, block)
    }

    trimTrailingAssistantText(messages)
    return messages.filter((message) => Array.isArray(message.content) && message.content.length > 0)
}

function responseContentToAnthropic(value: unknown) {
    if (typeof value === 'string') return value.trim() ? [{ type: 'text', text: value }] : []
    const parts = Array.isArray(value) ? value : isObject(value) ? [value] : []
    const blocks: JsonObject[] = []
    for (const part of parts) {
        if (!isObject(part)) continue
        if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
            const text = stringValue(part.text)
            if (text.trim()) blocks.push({ type: 'text', text })
        } else if (part.type === 'refusal') {
            const text = stringValue(part.refusal)
            if (text.trim()) blocks.push({ type: 'text', text })
        } else if (part.type === 'input_image') {
            const image = inputImageToAnthropic(part)
            if (image) blocks.push(image)
        }
    }
    return blocks
}

function inputImageToAnthropic(part: JsonObject) {
    const imageUrl = typeof part.image_url === 'string'
        ? part.image_url
        : isObject(part.image_url) ? stringValue(part.image_url.url) : ''
    if (/^https?:\/\//i.test(imageUrl)) {
        return { type: 'image', source: { type: 'url', url: imageUrl } }
    }
    const match = imageUrl.match(/^data:([^;,]+);base64,(.+)$/i)
    return match
        ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
        : null
}

function anthropicToolResult(value: unknown): unknown {
    if (typeof value === 'string') return value
    if (!Array.isArray(value)) return JSON.stringify(value ?? '')
    const blocks: JsonObject[] = []
    for (const part of value) {
        if (!isObject(part)) continue
        if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
            blocks.push({ type: 'text', text: stringValue(part.text) })
        } else if (part.type === 'input_image') {
            const image = inputImageToAnthropic(part)
            if (image) blocks.push(image)
        } else {
            blocks.push({ type: 'text', text: JSON.stringify(part) })
        }
    }
    return blocks
}

function chatToolToAnthropic(tool: JsonObject) {
    const fn = isObject(tool.function) ? tool.function : null
    const name = fn ? stringValue(fn.name) : ''
    if (!fn || !name) return null
    const parameters = isObject(fn.parameters) ? fn.parameters : {}
    return {
        name,
        description: stringValue(fn.description),
        input_schema: { ...parameters, type: 'object' },
        ...(typeof fn.strict === 'boolean' ? { strict: fn.strict } : {}),
    }
}

function anthropicToolChoice(value: unknown, context: CodexToolContext) {
    if (value === 'required') return { type: 'any' }
    if (value === 'auto') return { type: 'auto' }
    if (value === 'none') return { type: 'none' }
    if (!isObject(value)) return null
    if (value.type === 'function') {
        return { type: 'tool', name: context.chatNameFor(stringValue(value.name), stringValue(value.namespace) || undefined) }
    }
    if (value.type === 'custom') return { type: 'tool', name: stringValue(value.name) }
    if (value.type === 'tool_search') return { type: 'tool', name: 'tool_search' }
    return { type: 'auto' }
}

function anthropicThinkingBudget(effort: string, maxTokens: number) {
    const requested = effort === 'minimal' || effort === 'low'
        ? 2048
        : effort === 'medium'
          ? 8192
          : effort === 'high'
            ? 16384
            : effort === 'xhigh' || effort === 'max' || effort === 'ultra'
              ? 24576
              : 0
    const budget = Math.min(requested, Math.floor(maxTokens / 2))
    return budget >= 1024 ? budget : 0
}

function encodeAnthropicThinkingBlock(block: JsonObject) {
    const valid = block.type === 'thinking'
        ? Boolean(stringValue(block.signature))
        : block.type === 'redacted_thinking' && Boolean(stringValue(block.data))
    if (!valid) return ''
    return `${ANTHROPIC_THINKING_PREFIX}${Buffer.from(JSON.stringify(block)).toString('base64url')}`
}

function decodeAnthropicThinkingBlock(value: string) {
    if (!value.startsWith(ANTHROPIC_THINKING_PREFIX)) return null
    try {
        const parsed = JSON.parse(Buffer.from(value.slice(ANTHROPIC_THINKING_PREFIX.length), 'base64url').toString('utf8')) as unknown
        if (!isObject(parsed)) return null
        return encodeAnthropicThinkingBlock(parsed) ? parsed : null
    } catch {
        return null
    }
}

function pushBlock(messages: JsonObject[], role: 'user' | 'assistant', block: JsonObject, prepend = false) {
    const last = messages.at(-1)
    if (last?.role === role && Array.isArray(last.content)) {
        if (prepend) last.content.unshift(block)
        else last.content.push(block)
        return
    }
    messages.push({ role, content: [block] })
}

function pushToolResult(messages: JsonObject[], block: JsonObject) {
    const last = messages.at(-1)
    if (last?.role === 'user' && Array.isArray(last.content)) {
        const firstNonResult = last.content.findIndex((item) => !isObject(item) || item.type !== 'tool_result')
        last.content.splice(firstNonResult < 0 ? last.content.length : firstNonResult, 0, block)
        return
    }
    messages.push({ role: 'user', content: [block] })
}

function trimTrailingAssistantText(messages: JsonObject[]) {
    const last = messages.at(-1)
    if (last?.role !== 'assistant' || !Array.isArray(last.content)) return
    const block = last.content.at(-1)
    if (!isObject(block) || block.type !== 'text') return
    const text = stringValue(block.text).trimEnd()
    if (text) block.text = text
    else last.content.pop()
}

function trailingTurnSupportsThinking(messages: JsonObject[]) {
    const last = messages.at(-1)
    if (last?.role !== 'user' || !Array.isArray(last.content)) return false
    const resultIds = last.content
        .filter(isObject)
        .filter((block) => block.type === 'tool_result')
        .map((block) => stringValue(block.tool_use_id))
        .filter(Boolean)
    if (resultIds.length === 0) return true

    const assistant = messages.at(-2)
    if (assistant?.role !== 'assistant' || !Array.isArray(assistant.content)) return false
    const hasSignedThinking = assistant.content
        .filter(isObject)
        .some((block) => block.type === 'thinking' || block.type === 'redacted_thinking')
    if (!hasSignedThinking) return false
    const callIds = new Set(assistant.content
        .filter(isObject)
        .filter((block) => block.type === 'tool_use')
        .map((block) => stringValue(block.id))
        .filter(Boolean))
    return resultIds.every((id) => callIds.has(id))
}

function parseArguments(value: unknown, name: string) {
    if (isObject(value)) return value
    const text = stringValue(value).trim()
    if (!text) return {}
    try {
        const parsed = JSON.parse(text) as unknown
        if (isObject(parsed)) return parsed
    } catch {
        // Report the protocol error below.
    }
    throw new Error(`Function call arguments for ${name || '(unnamed tool)'} must be a JSON object.`)
}

function textParts(value: unknown) {
    if (typeof value === 'string') return value.trim() ? [value.trim()] : []
    const parts = Array.isArray(value) ? value : []
    return parts
        .filter(isObject)
        .filter((part) => part.type === 'input_text' || part.type === 'output_text' || part.type === 'text')
        .map((part) => stringValue(part.text).trim())
        .filter(Boolean)
}

function isCallType(value: unknown) {
    return value === 'function_call' || value === 'custom_tool_call' || value === 'tool_search_call'
}

function positiveInteger(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value : ''
}
