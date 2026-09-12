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
import { AnthropicWebCitations, anthropicWebSearchItem, anthropicWebSearchReplayItem, needsAnthropicSearchContinuation } from './anthropic-web-search'

type JsonObject = Record<string, unknown>

type TextBlock = {
    kind: 'text'
    outputIndex: number
    itemId: string
    text: string
    block: JsonObject
}

type ThinkingBlock = {
    kind: 'thinking'
    outputIndex: number
    itemId: string
    block: JsonObject
    summaryStarted: boolean
}

type ToolBlock = {
    kind: 'tool' | 'web_search'
    outputIndex: number
    itemId: string
    callId: string
    name: string
    arguments: string
    block: JsonObject
}

type SearchResultBlock = { kind: 'web_search_result'; block: JsonObject }
type BlockState = TextBlock | ThinkingBlock | ToolBlock | SearchResultBlock

type AnthropicStreamInput = {
    upstream: ReadableStream<Uint8Array>
    context: CodexToolContext
    continueMessage?: (message: JsonObject) => Promise<ReadableStream<Uint8Array>>
    onComplete?: (response: JsonObject) => void
}

export function createAnthropicToResponsesStream(input: AnthropicStreamInput) {
    let reader = input.upstream.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const state = new AnthropicStreamState(input.context, Boolean(input.continueMessage))
    let buffer = ''
    let closed = false
    let continuations = 0

    return new ReadableStream<Uint8Array>({
        start(controller) {
            void pump().catch((error) => {
                void reader.cancel().catch(() => {})
                if (!closed) controller.error(error)
            })

            async function pump() {
                readLoop: while (!closed) {
                    const { done, value } = await reader.read()
                    if (value) buffer += decoder.decode(value, { stream: !done })
                    const parsed = takeSseBlocks(buffer)
                    buffer = parsed.remainder
                    for (const block of parsed.blocks) {
                        const result = state.consume(block)
                        for (const event of result.events) controller.enqueue(encoder.encode(event))
                        if (result.continuation && input.continueMessage) {
                            await reader.cancel()
                            if (++continuations > 10) throw new Error('Anthropic web search exceeded the continuation limit.')
                            const upstream = await input.continueMessage(result.continuation)
                            if (closed) {
                                await upstream.cancel()
                                return
                            }
                            reader = upstream.getReader()
                            buffer = ''
                            continue readLoop
                        }
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

export async function readAnthropicSseAsResponses(input: Omit<AnthropicStreamInput, 'onComplete'>): Promise<JsonObject> {
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
    private readonly previousUsage: Record<string, number> = {}
    private readonly rawBlocks = new Map<number, JsonObject>()
    private readonly searches = new Map<string, ToolBlock>()
    private readonly citations = new AnthropicWebCitations()
    private nextOutputIndex = 0
    private readonly blocks = new Map<number, BlockState>()
    private readonly output: Array<{ index: number; item: JsonObject }> = []

    constructor(private readonly context: CodexToolContext, private readonly allowSearchContinuation = false) {}

    get isCompleted() {
        return this.completed
    }

    consume(block: string): { events: string[]; completed?: JsonObject; continuation?: JsonObject } {
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
            const content = [...this.rawBlocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block)
            if (this.allowSearchContinuation && needsAnthropicSearchContinuation(this.stopReason, content)) {
                return { events: [], continuation: { role: 'assistant', content } }
            }
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
        if (!this.started) this.responseId = responseIdFromAnthropic(message.id)
        for (const [key, value] of Object.entries(this.rawUsage)) {
            if (typeof value === 'number') this.previousUsage[key] = (this.previousUsage[key] ?? 0) + value
        }
        this.rawBlocks.clear()
        this.stopReason = ''
        this.model = stringValue(message.model)
        this.rawUsage = isObject(message.usage) ? { ...message.usage } : {}
        return this.ensureStarted()
    }

    private startBlock(event: JsonObject) {
        const index = integerValue(event.index)
        const block = isObject(event.content_block) ? event.content_block : {}
        const events = this.ensureStarted()
        if (block.type === 'text') {
            const outputIndex = this.nextIndex()
            const state: TextBlock = {
                kind: 'text',
                outputIndex,
                itemId: `${this.responseId}_msg_${outputIndex}`,
                text: '',
                block: { ...block, text: '' },
            }
            this.blocks.set(index, state)
            events.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: state.outputIndex, item: { id: state.itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] } }))
            events.push(sse('response.content_part.added', { type: 'response.content_part.added', item_id: state.itemId, output_index: state.outputIndex, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }))
            const initial = stringValue(block.text)
            if (initial) events.push(...this.pushText(state, initial))
            const links = this.citations.render(block.citations, state.text)
            if (links) events.push(...this.pushText(state, links, false))
        } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
            const outputIndex = this.nextIndex()
            const state: ThinkingBlock = {
                kind: 'thinking',
                outputIndex,
                itemId: `rs_${this.responseId}_${outputIndex}`,
                block: block.type === 'thinking' ? { ...block, thinking: '' } : { ...block },
                summaryStarted: false,
            }
            this.blocks.set(index, state)
            events.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: state.outputIndex, item: { id: state.itemId, type: 'reasoning', status: 'in_progress', summary: [] } }))
            const initial = stringValue(block.thinking)
            if (initial) events.push(...this.pushThinking(state, initial))
        } else if (block.type === 'tool_use' || (block.type === 'server_tool_use' && block.name === 'web_search')) {
            const callId = stringValue(block.id) || `call_${crypto.randomUUID()}`
            const name = stringValue(block.name)
            const state: ToolBlock = {
                kind: block.type === 'server_tool_use' ? 'web_search' : 'tool',
                outputIndex: this.nextIndex(),
                itemId: block.type === 'server_tool_use' ? `ws_${callId}` : responseItemId(callId, name, this.context),
                callId,
                name,
                arguments: isObject(block.input) && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : '',
                block: { ...block, id: callId },
            }
            this.blocks.set(index, state)
            const item = state.kind === 'web_search'
                ? anthropicWebSearchItem(state.block)
                : responseItemFromChatToolCall({ callId, chatName: name, arguments: '', status: 'in_progress', context: this.context })
            events.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: state.outputIndex, item }))
            if (state.kind === 'web_search') {
                events.push(sse('response.web_search_call.in_progress', { type: 'response.web_search_call.in_progress', item_id: state.itemId, output_index: state.outputIndex }))
            }
        } else if (block.type === 'web_search_tool_result') {
            this.blocks.set(index, { kind: 'web_search_result', block: { ...block } })
        }
        return events
    }

    private deltaBlock(event: JsonObject) {
        const state = this.blocks.get(integerValue(event.index))
        const delta = isObject(event.delta) ? event.delta : {}
        if (!state) return []
        if (state.kind === 'text' && delta.type === 'text_delta') return this.pushText(state, stringValue(delta.text))
        if (state.kind === 'text' && delta.type === 'citations_delta' && isObject(delta.citation)) {
            const citations = Array.isArray(state.block.citations) ? state.block.citations : []
            state.block.citations = [...citations, delta.citation]
            const links = this.citations.render([delta.citation], state.text)
            return links ? this.pushText(state, links, false) : []
        }
        if (state.kind === 'thinking') {
            if (delta.type === 'thinking_delta') return this.pushThinking(state, stringValue(delta.thinking))
            if (delta.type === 'signature_delta') state.block.signature = stringValue(delta.signature)
            return []
        }
        if ((state.kind === 'tool' || state.kind === 'web_search') && delta.type === 'input_json_delta') {
            const value = stringValue(delta.partial_json)
            state.arguments += value
            if (state.kind === 'tool' && value && !this.context.isCustom(state.name)) {
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
        if (state.kind === 'web_search') state.block.input = JSON.parse(state.arguments || '{}')
        this.rawBlocks.set(index, state.block)
        if (state.kind === 'web_search') {
            this.searches.set(state.callId, state)
            return [sse('response.web_search_call.searching', { type: 'response.web_search_call.searching', item_id: state.itemId, output_index: state.outputIndex })]
        }
        if (state.kind === 'web_search_result') {
            const call = this.searches.get(stringValue(state.block.tool_use_id))
            if (!call) return []
            this.searches.delete(call.callId)
            const item = anthropicWebSearchItem(call.block, state.block)
            const replay = anthropicWebSearchReplayItem(call.block, state.block)
            const replayIndex = this.nextIndex()
            this.output.push({ index: call.outputIndex, item }, { index: replayIndex, item: replay })
            const events = [sse('response.output_item.done', { type: 'response.output_item.done', output_index: call.outputIndex, item })]
            if (item.status === 'completed') events.unshift(sse('response.web_search_call.completed', { type: 'response.web_search_call.completed', item_id: item.id, output_index: call.outputIndex }))
            events.push(
                sse('response.output_item.added', { type: 'response.output_item.added', output_index: replayIndex, item: replay }),
                sse('response.output_item.done', { type: 'response.output_item.done', output_index: replayIndex, item: replay }),
            )
            return events
        }
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
            const item = reasoningItemFromAnthropicBlock(`${this.responseId}_${state.outputIndex}`, state.block) ?? {
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

    private pushText(state: TextBlock, delta: string, original = true) {
        if (!delta) return []
        state.text += delta
        if (original) state.block.text = stringValue(state.block.text) + delta
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
        const usage = { ...this.rawUsage }
        for (const [key, value] of Object.entries(this.previousUsage)) usage[key] = (typeof usage[key] === 'number' ? usage[key] : 0) + value
        return {
            id: this.responseId,
            object: 'response',
            created_at: this.createdAt,
            status,
            model: this.model,
            output,
            usage: anthropicUsageToResponses(usage),
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
