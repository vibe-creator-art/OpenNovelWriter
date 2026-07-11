import crypto from 'crypto'

import type { CodexProviderModel } from '@/lib/codex-config'
import {
    canonicalArguments,
    CodexToolContext,
    isObject,
    responseItemFromChatToolCall,
} from '@/lib/server/codex-proxy/tool-context'

type JsonObject = Record<string, unknown>

export function responsesToChatRequest(
    body: JsonObject,
    model: CodexProviderModel,
    context: CodexToolContext
) {
    const result: JsonObject = {
        model: body.model,
        messages: buildChatMessages(body, context),
        stream: body.stream === true,
    }

    for (const key of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed', 'stop']) {
        if (body[key] !== undefined) result[key] = body[key]
    }
    if (body.max_output_tokens !== undefined) result.max_tokens = body.max_output_tokens
    if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens

    if (context.chatTools.length > 0) {
        result.tools = context.chatTools
        result.tool_choice = mapToolChoice(body.tool_choice, context)
        if (body.parallel_tool_calls !== undefined) result.parallel_tool_calls = body.parallel_tool_calls
    }

    applyChatReasoning(result, body, model)
    if (result.stream === true) {
        const existing = isObject(body.stream_options) ? body.stream_options : {}
        result.stream_options = { ...existing, include_usage: true }
    }
    return result
}

export function chatCompletionToResponse(
    body: JsonObject,
    context: CodexToolContext
) {
    const choice = Array.isArray(body.choices) && isObject(body.choices[0]) ? body.choices[0] : null
    const message = choice && isObject(choice.message) ? choice.message : null
    if (!choice || !message) throw new Error('Chat upstream returned no completion choice.')

    const responseId = responseIdFromChat(body.id)
    const output: unknown[] = []
    const reasoning = extractReasoning(message)
    if (reasoning) {
        output.push({
            id: `rs_${responseId}`,
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: reasoning }],
        })
    }
    const text = extractMessageText(message)
    if (text) {
        output.push({
            id: `${responseId}_msg`,
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text, annotations: [] }],
        })
    }
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    for (let index = 0; index < toolCalls.length; index += 1) {
        const call = isObject(toolCalls[index]) ? toolCalls[index] : null
        const fn = call && isObject(call.function) ? call.function : null
        const name = typeof fn?.name === 'string' ? fn.name : ''
        if (!name) continue
        output.push(responseItemFromChatToolCall({
            callId: typeof call?.id === 'string' && call.id ? call.id : `call_${index}`,
            chatName: name,
            arguments: canonicalArguments(fn?.arguments),
            status: 'completed',
            context,
            reasoning,
        }))
    }

    const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null
    return {
        id: responseId,
        object: 'response',
        created_at: typeof body.created === 'number' ? body.created : Math.floor(Date.now() / 1000),
        status: finishReason === 'length' ? 'incomplete' : 'completed',
        model: typeof body.model === 'string' ? body.model : '',
        output,
        usage: chatUsageToResponses(body.usage),
        ...(finishReason === 'length' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    }
}

export function chatUsageToResponses(value: unknown) {
    const usage = isObject(value) ? value : {}
    const input = numberValue(usage.prompt_tokens)
    const output = numberValue(usage.completion_tokens)
    const details = isObject(usage.completion_tokens_details) ? usage.completion_tokens_details : {}
    return {
        input_tokens: input,
        output_tokens: output,
        total_tokens: numberValue(usage.total_tokens) || input + output,
        output_tokens_details: { reasoning_tokens: numberValue(details.reasoning_tokens) },
    }
}

export function extractReasoning(value: JsonObject) {
    for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
        if (typeof value[key] === 'string' && value[key].trim()) return value[key]
    }
    const content = typeof value.content === 'string' ? value.content : ''
    const match = content.match(/^\s*<think>([\s\S]*?)<\/think>\s*/i)
    return match?.[1]?.trim() || ''
}

export function stripLeadingThink(value: string) {
    return value.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '')
}

function buildChatMessages(body: JsonObject, context: CodexToolContext) {
    const messages: JsonObject[] = []
    if (typeof body.instructions === 'string' && body.instructions.trim()) {
        messages.push({ role: 'system', content: body.instructions })
    }
    const input = Array.isArray(body.input) ? body.input : body.input === undefined ? [] : [body.input]
    const pendingCalls: JsonObject[] = []

    const flushCalls = () => {
        if (pendingCalls.length === 0) return
        messages.push({ role: 'assistant', content: null, reasoning_content: 'tool call', tool_calls: pendingCalls.splice(0) })
    }

    for (const item of input) {
        if (typeof item === 'string') {
            flushCalls()
            messages.push({ role: 'user', content: item })
            continue
        }
        if (!isObject(item)) continue
        const type = typeof item.type === 'string' ? item.type : 'message'
        if (type === 'additional_tools') continue
        if (type === 'function_call') {
            const name = typeof item.name === 'string' ? item.name : ''
            const namespace = typeof item.namespace === 'string' ? item.namespace : undefined
            pendingCalls.push({
                id: stringValue(item.call_id) || stringValue(item.id),
                type: 'function',
                function: {
                    name: context.chatNameFor(name, namespace),
                    arguments: canonicalArguments(item.arguments),
                },
            })
            continue
        }
        if (type === 'custom_tool_call') {
            pendingCalls.push({
                id: stringValue(item.call_id) || stringValue(item.id),
                type: 'function',
                function: {
                    name: stringValue(item.name),
                    arguments: JSON.stringify({ input: typeof item.input === 'string' ? item.input : '' }),
                },
            })
            continue
        }
        if (type === 'tool_search_call') {
            pendingCalls.push({
                id: stringValue(item.call_id) || stringValue(item.id),
                type: 'function',
                function: { name: 'tool_search', arguments: canonicalArguments(item.arguments) },
            })
            continue
        }
        if (type === 'function_call_output' || type === 'custom_tool_call_output' || type === 'tool_search_output') {
            flushCalls()
            messages.push({
                role: 'tool',
                tool_call_id: stringValue(item.call_id),
                content:
                    typeof item.output === 'string'
                        ? item.output
                        : JSON.stringify(item.output ?? item),
            })
            continue
        }
        if (type === 'reasoning') continue

        flushCalls()
        const role = item.role === 'assistant' ? 'assistant' : item.role === 'system' || item.role === 'developer' ? 'system' : 'user'
        messages.push({ role, content: responseContentToChat(item.content ?? item) })
    }
    flushCalls()
    return messages
}

function responseContentToChat(value: unknown): unknown {
    if (typeof value === 'string') return value
    const parts = Array.isArray(value) ? value : isObject(value) ? [value] : []
    const output: JsonObject[] = []
    let onlyText = true
    for (const part of parts) {
        if (!isObject(part)) continue
        if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
            if (typeof part.text === 'string') output.push({ type: 'text', text: part.text })
        } else if (part.type === 'input_image' && part.image_url !== undefined) {
            onlyText = false
            output.push({ type: 'image_url', image_url: typeof part.image_url === 'string' ? { url: part.image_url } : part.image_url })
        }
    }
    return onlyText ? output.map((part) => part.text).filter(Boolean).join('\n') : output
}

function mapToolChoice(value: unknown, context: CodexToolContext) {
    if (!isObject(value)) return value ?? 'auto'
    if (value.type === 'function') {
        return {
            type: 'function',
            function: {
                name: context.chatNameFor(stringValue(value.name), stringValue(value.namespace) || undefined),
            },
        }
    }
    if (value.type === 'custom' || value.type === 'tool_search') {
        return { type: 'function', function: { name: value.type === 'tool_search' ? 'tool_search' : stringValue(value.name) } }
    }
    return value
}

function applyChatReasoning(result: JsonObject, body: JsonObject, model: CodexProviderModel) {
    const config = model.chatReasoning ?? inferChatReasoning(model.id)
    if (!config) return
    const effort = isObject(body.reasoning) ? stringValue(body.reasoning.effort) : ''
    const enabled = effort !== 'none' && effort !== 'minimal'
    if (config.supportsThinking && config.thinkingParam !== 'none') {
        if (config.thinkingParam === 'enable_thinking') result.enable_thinking = enabled
        else result.thinking = { type: enabled ? 'enabled' : 'disabled' }
    }
    if (enabled && config.supportsEffort && config.effortParam !== 'none' && effort) {
        result[config.effortParam] = effort
    }
}

function inferChatReasoning(modelId: string): CodexProviderModel['chatReasoning'] {
    const value = modelId.toLowerCase()
    if (value.includes('glm') || value.includes('zhipu')) {
        return {
            supportsThinking: true,
            supportsEffort: false,
            thinkingParam: 'thinking',
            effortParam: 'none',
            outputFormat: 'reasoning_content',
        }
    }
    if (value.includes('qwen')) {
        return {
            supportsThinking: true,
            supportsEffort: false,
            thinkingParam: 'enable_thinking',
            effortParam: 'none',
            outputFormat: 'reasoning_content',
        }
    }
    if (value.includes('deepseek')) {
        return {
            supportsThinking: true,
            supportsEffort: true,
            thinkingParam: 'thinking',
            effortParam: 'reasoning_effort',
            outputFormat: 'reasoning_content',
        }
    }
    if (value.includes('kimi') || value.includes('moonshot')) {
        return {
            supportsThinking: true,
            supportsEffort: false,
            thinkingParam: 'thinking',
            effortParam: 'none',
            outputFormat: 'reasoning_content',
        }
    }
    return undefined
}

function extractMessageText(message: JsonObject) {
    if (typeof message.content === 'string') return stripLeadingThink(message.content)
    if (!Array.isArray(message.content)) return ''
    return message.content
        .filter(isObject)
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
}

function responseIdFromChat(value: unknown) {
    const id = typeof value === 'string' && value ? value : crypto.randomUUID()
    return id.startsWith('resp_') ? id : `resp_${id.replace(/^chatcmpl[_-]?/, '')}`
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}
