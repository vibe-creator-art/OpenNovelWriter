import crypto from 'node:crypto'

import {
    anthropicResponseToResponses,
    anthropicUsageToResponses,
    reasoningItemFromAnthropicBlock,
    responseIdFromAnthropic,
    responsesStatusFromAnthropic,
} from './anthropic-transform'
import { isObject, canonicalArguments, CodexToolContext, customInput, responseItemFromChatToolCall, responseItemId } from './tool-context'
import { sse, sseData, takeSseBlocks } from './sse'

type JsonObject = Record<string, unknown>

type TextBlock = {
    kind: 'text'
    outputIndex: number
    itemId: string
    text: string
}

type ThinkingBlock = {
    kind: 'thinking'
    outputIndex: number
    itemId: string
    block: JsonObject
    summaryStarted: boolean
}

type ToolBlock = {
    kind: 'tool'
    outputIndex: number
    itemId: string
    callId: string
    name: string
    arguments: string
}

type BlockState = TextBlock | ThinkingBlock | ToolBlock

export function createAnthropicToResponsesStream(input: {
    upstream: ReadableStream<Uint8Array>
    context: CodexToolContext
    onComplete?: (response: JsonObject) => void
}) {
    const reader = input.upstream.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const state = new AnthropicStreamState(input.context)
    let buffer = ''
    let closed = false

    return new ReadableStream<Uint8Array>({
        start(controller) {
            void pump().catch((error) => {
                if (!closed) controller.error(error)
            })

            async function pump() {
                while (true) {
                    const { done, value } = await reader.read()
                    if (value) buffer += decoder.decode(value, { stream: !done })
                    const parsed = takeSseBlocks(buffer)
                    buffer = parsed.remainder
                    for (const block of parsed.blocks) {
                        const result = state.consume(block)
                        for (const event of result.events) controller.enqueue(encoder.encode(event))
                        if (result.completed) {
                            input.onComplete?.(result.completed)
                            await reader.cancel()
                            closed = true
                            controller.close()
                            return
                        }
                    }
                    if (!done) continue
                    if (buffer.trim()) {
                        const result = state.consume(buffer)
                        for (const event of result.events) controller.enqueue(encoder.encode(event))
                        if (result.completed) input.onComplete?.(result.completed)
                    }
                    if (!state.isCompleted) {
                        const final = state.finalize(true)
                        for (const event of final.events) controller.enqueue(encoder.encode(event))
                        input.onComplete?.(final.response)
                    }
                    closed = true
                    controller.close()
                    return
                }
            }
        },
        cancel() {
            closed = true
            void reader.cancel()
        },
    })
}

export async function readAnthropicSseAsResponses(input: {
    upstream: ReadableStream<Uint8Array>
    context: CodexToolContext
}) {
    let completed: JsonObject | null = null
    const stream = createAnthropicToResponsesStream({
        ...input,
        onComplete: (response) => { completed = response },
    })
    await new Response(stream).arrayBuffer()
    if (!completed) throw new Error('Anthropic upstream stream ended without a response.')
    return completed
}

export function responsesSseFromAnthropicMessage(body: JsonObject, context: CodexToolContext) {
    const response = anthropicResponseToResponses(body, context)
    const initial = { ...response, status: 'in_progress', output: [] }
    const events = [
        sse('response.created', { type: 'response.created', response: initial }),
        sse('response.in_progress', { type: 'response.in_progress', response: initial }),
    ]
    const output = Array.isArray(response.output) ? response.output : []
    for (let index = 0; index < output.length; index += 1) {
        const item = isObject(output[index]) ? output[index] : null
        if (!item) continue
        events.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: index, item: { ...item, status: 'in_progress' } }))
        if (item.type === 'message' && Array.isArray(item.content)) {
            for (let contentIndex = 0; contentIndex < item.content.length; contentIndex += 1) {
                const part = isObject(item.content[contentIndex]) ? item.content[contentIndex] : null
                if (!part || part.type !== 'output_text') continue
                events.push(sse('response.content_part.added', { type: 'response.content_part.added', item_id: item.id, output_index: index, content_index: contentIndex, part: { ...part, text: '' } }))
                events.push(sse('response.output_text.delta', { type: 'response.output_text.delta', item_id: item.id, output_index: index, content_index: contentIndex, delta: part.text }))
                events.push(sse('response.output_text.done', { type: 'response.output_text.done', item_id: item.id, output_index: index, content_index: contentIndex, text: part.text }))
                events.push(sse('response.content_part.done', { type: 'response.content_part.done', item_id: item.id, output_index: index, content_index: contentIndex, part }))
            }
        } else if (item.type === 'function_call') {
            events.push(sse('response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: index, delta: item.arguments }))
            events.push(sse('response.function_call_arguments.done', { type: 'response.function_call_arguments.done', item_id: item.id, output_index: index, arguments: item.arguments }))
        } else if (item.type === 'custom_tool_call') {
            events.push(sse('response.custom_tool_call_input.delta', { type: 'response.custom_tool_call_input.delta', item_id: item.id, output_index: index, delta: item.input }))
            events.push(sse('response.custom_tool_call_input.done', { type: 'response.custom_tool_call_input.done', item_id: item.id, output_index: index, input: item.input }))
        }
        events.push(sse('response.output_item.done', { type: 'response.output_item.done', output_index: index, item }))
    }
    events.push(sse('response.completed', { type: 'response.completed', response }))
    return events
}

class AnthropicStreamState {
    private started = false
    private completed = false
    private responseId = `resp_${crypto.randomUUID()}`
    private model = ''
    private createdAt = Math.floor(Date.now() / 1000)
    private stopReason = ''
    private rawUsage: JsonObject = {}
    private nextOutputIndex = 0
    private readonly blocks = new Map<number, BlockState>()
    private readonly output: Array<{ index: number; item: JsonObject }> = []

    constructor(private readonly context: CodexToolContext) {}

    get isCompleted() {
        return this.completed
    }

    consume(block: string): { events: string[]; completed?: JsonObject } {
        const data = sseData(block)
        if (!data || data === '[DONE]') return { events: [] }
        let event: JsonObject
        try {
            const parsed = JSON.parse(data) as unknown
            if (!isObject(parsed)) return { events: [] }
            event = parsed
        } catch {
            return { events: [] }
        }

        if (event.type === 'error') {
            this.completed = true
            const error = isObject(event.error) ? event.error : { message: 'Anthropic upstream stream failed.' }
            const response = { ...this.baseResponse('failed'), error }
            return { events: [sse('response.failed', { type: 'response.failed', response })], completed: response }
        }
        if (event.type === 'message_start') return { events: this.startMessage(event) }
        if (event.type === 'content_block_start') return { events: this.startBlock(event) }
        if (event.type === 'content_block_delta') return { events: this.deltaBlock(event) }
        if (event.type === 'content_block_stop') return { events: this.stopBlock(event) }
        if (event.type === 'message_delta') {
            if (isObject(event.delta)) this.stopReason = stringValue(event.delta.stop_reason) || this.stopReason
            if (isObject(event.usage)) this.rawUsage = { ...this.rawUsage, ...event.usage }
            return { events: [] }
        }
        if (event.type === 'message_stop') {
            const final = this.finalize()
            return { events: final.events, completed: final.response }
        }
        return { events: [] }
    }

    finalize(truncated = false) {
        if (this.completed) return { events: [], response: this.baseResponse('failed') }
        const events = this.ensureStarted()
        for (const index of [...this.blocks.keys()].sort((a, b) => a - b)) events.push(...this.finishBlock(index))
        if (truncated && !this.stopReason) this.stopReason = 'max_tokens'
        const { status, reason } = responsesStatusFromAnthropic(this.stopReason)
        const response = this.baseResponse(status)
        if (reason) response.incomplete_details = { reason }
        events.push(sse('response.completed', { type: 'response.completed', response }))
        this.completed = true
        return { events, response }
    }

    private startMessage(event: JsonObject) {
        const message = isObject(event.message) ? event.message : {}
        this.responseId = responseIdFromAnthropic(message.id)
        this.model = stringValue(message.model)
        if (isObject(message.usage)) this.rawUsage = { ...message.usage }
        return this.ensureStarted()
    }

    private startBlock(event: JsonObject) {
        const index = integerValue(event.index)
        const block = isObject(event.content_block) ? event.content_block : {}
        const events = this.ensureStarted()
        if (block.type === 'text') {
            const state: TextBlock = {
                kind: 'text',
                outputIndex: this.nextIndex(),
                itemId: `${this.responseId}_msg_${index}`,
                text: '',
            }
            this.blocks.set(index, state)
            events.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: state.outputIndex, item: { id: state.itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] } }))
            events.push(sse('response.content_part.added', { type: 'response.content_part.added', item_id: state.itemId, output_index: state.outputIndex, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }))
            const initial = stringValue(block.text)
            if (initial) events.push(...this.pushText(state, initial))
        } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
            const state: ThinkingBlock = {
                kind: 'thinking',
                outputIndex: this.nextIndex(),
                itemId: `rs_${this.responseId}_${index}`,
                block: block.type === 'thinking' ? { ...block, thinking: '' } : { ...block },
                summaryStarted: false,
            }
            this.blocks.set(index, state)
            events.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: state.outputIndex, item: { id: state.itemId, type: 'reasoning', status: 'in_progress', summary: [] } }))
            const initial = stringValue(block.thinking)
            if (initial) events.push(...this.pushThinking(state, initial))
        } else if (block.type === 'tool_use') {
            const callId = stringValue(block.id) || `call_${crypto.randomUUID()}`
            const name = stringValue(block.name)
            const state: ToolBlock = {
                kind: 'tool',
                outputIndex: this.nextIndex(),
                itemId: responseItemId(callId, name, this.context),
                callId,
                name,
                arguments: isObject(block.input) && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : '',
            }
            this.blocks.set(index, state)
            events.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: state.outputIndex, item: responseItemFromChatToolCall({ callId, chatName: name, arguments: '', status: 'in_progress', context: this.context }) }))
        }
        return events
    }

    private deltaBlock(event: JsonObject) {
        const state = this.blocks.get(integerValue(event.index))
        const delta = isObject(event.delta) ? event.delta : {}
        if (!state) return []
        if (state.kind === 'text' && delta.type === 'text_delta') return this.pushText(state, stringValue(delta.text))
        if (state.kind === 'thinking') {
            if (delta.type === 'thinking_delta') return this.pushThinking(state, stringValue(delta.thinking))
            if (delta.type === 'signature_delta') state.block.signature = stringValue(delta.signature)
            return []
        }
        if (state.kind === 'tool' && delta.type === 'input_json_delta') {
            const value = stringValue(delta.partial_json)
            state.arguments += value
            if (value && !this.context.isCustom(state.name)) {
                return [sse('response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', item_id: state.itemId, output_index: state.outputIndex, delta: value })]
            }
        }
        return []
    }

    private stopBlock(event: JsonObject) {
        return this.finishBlock(integerValue(event.index))
    }

    private finishBlock(index: number) {
        const state = this.blocks.get(index)
        if (!state) return []
        this.blocks.delete(index)
        if (state.kind === 'text') {
            const part = { type: 'output_text', text: state.text, annotations: [] }
            const item = { id: state.itemId, type: 'message', status: 'completed', role: 'assistant', content: [part] }
            this.output.push({ index: state.outputIndex, item })
            return [
                sse('response.output_text.done', { type: 'response.output_text.done', item_id: state.itemId, output_index: state.outputIndex, content_index: 0, text: state.text }),
                sse('response.content_part.done', { type: 'response.content_part.done', item_id: state.itemId, output_index: state.outputIndex, content_index: 0, part }),
                sse('response.output_item.done', { type: 'response.output_item.done', output_index: state.outputIndex, item }),
            ]
        }
        if (state.kind === 'thinking') {
            const thinking = stringValue(state.block.thinking)
            const item = reasoningItemFromAnthropicBlock(`${this.responseId}_${index}`, state.block) ?? {
                id: state.itemId,
                type: 'reasoning',
                summary: thinking ? [{ type: 'summary_text', text: thinking }] : [],
            }
            const events: string[] = []
            if (state.summaryStarted) {
                events.push(sse('response.reasoning_summary_text.done', { type: 'response.reasoning_summary_text.done', item_id: state.itemId, output_index: state.outputIndex, summary_index: 0, text: thinking }))
                events.push(sse('response.reasoning_summary_part.done', { type: 'response.reasoning_summary_part.done', item_id: state.itemId, output_index: state.outputIndex, summary_index: 0, part: { type: 'summary_text', text: thinking } }))
            }
            events.push(sse('response.output_item.done', { type: 'response.output_item.done', output_index: state.outputIndex, item }))
            this.output.push({ index: state.outputIndex, item })
            return events
        }

        const argumentsValue = canonicalArguments(state.arguments)
        const item = responseItemFromChatToolCall({ callId: state.callId, chatName: state.name, arguments: argumentsValue, status: 'completed', context: this.context })
        const events: string[] = []
        if (this.context.isCustom(state.name)) {
            const value = customInput(argumentsValue)
            if (value) events.push(sse('response.custom_tool_call_input.delta', { type: 'response.custom_tool_call_input.delta', item_id: state.itemId, output_index: state.outputIndex, delta: value }))
            events.push(sse('response.custom_tool_call_input.done', { type: 'response.custom_tool_call_input.done', item_id: state.itemId, output_index: state.outputIndex, input: value }))
        } else {
            events.push(sse('response.function_call_arguments.done', { type: 'response.function_call_arguments.done', item_id: state.itemId, output_index: state.outputIndex, arguments: argumentsValue }))
        }
        events.push(sse('response.output_item.done', { type: 'response.output_item.done', output_index: state.outputIndex, item }))
        this.output.push({ index: state.outputIndex, item })
        return events
    }

    private pushText(state: TextBlock, delta: string) {
        if (!delta) return []
        state.text += delta
        return [sse('response.output_text.delta', { type: 'response.output_text.delta', item_id: state.itemId, output_index: state.outputIndex, content_index: 0, delta })]
    }

    private pushThinking(state: ThinkingBlock, delta: string) {
        if (!delta) return []
        const current = stringValue(state.block.thinking)
        state.block.thinking = current + delta
        const events: string[] = []
        if (!state.summaryStarted) {
            state.summaryStarted = true
            events.push(sse('response.reasoning_summary_part.added', { type: 'response.reasoning_summary_part.added', item_id: state.itemId, output_index: state.outputIndex, summary_index: 0, part: { type: 'summary_text', text: '' } }))
        }
        events.push(sse('response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', item_id: state.itemId, output_index: state.outputIndex, summary_index: 0, delta }))
        return events
    }

    private ensureStarted() {
        if (this.started) return []
        this.started = true
        const response = this.baseResponse('in_progress', [])
        return [
            sse('response.created', { type: 'response.created', response }),
            sse('response.in_progress', { type: 'response.in_progress', response }),
        ]
    }

    private baseResponse(status: string, output = this.output.sort((a, b) => a.index - b.index).map((entry) => entry.item)): JsonObject {
        return {
            id: this.responseId,
            object: 'response',
            created_at: this.createdAt,
            status,
            model: this.model,
            output,
            usage: anthropicUsageToResponses(this.rawUsage),
        }
    }

    private nextIndex() {
        const value = this.nextOutputIndex
        this.nextOutputIndex += 1
        return value
    }
}

function integerValue(value: unknown) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value : ''
}
