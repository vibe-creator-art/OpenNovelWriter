import crypto from 'crypto'

import {
    canonicalArguments,
    CodexToolContext,
    customInput,
    isObject,
    responseItemFromChatToolCall,
    responseItemId,
} from '@/lib/server/codex-proxy/tool-context'
import {
    chatUsageToResponses,
    extractReasoning,
    stripLeadingThink,
} from '@/lib/server/codex-proxy/transform'

type JsonObject = Record<string, unknown>

type ToolState = {
    outputIndex: number
    itemId: string
    callId: string
    name: string
    arguments: string
    added: boolean
}

export function createChatToResponsesStream(input: {
    upstream: ReadableStream<Uint8Array>
    context: CodexToolContext
    onComplete?: (response: JsonObject) => void
}) {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const reader = input.upstream.getReader()
    const state = new ChatStreamState(input.context)
    let buffer = ''
    let closed = false

    return new ReadableStream<Uint8Array>({
        start(controller) {
            void pumpChatStream({
                reader,
                decoder,
                encoder,
                state,
                getBuffer: () => buffer,
                setBuffer: (value) => { buffer = value },
                controller,
                onComplete: input.onComplete,
                close: () => { closed = true },
            }).catch((error) => {
                if (!closed) controller.error(error)
            })
        },
        cancel() {
            closed = true
            void reader.cancel()
        },
    })
}

async function pumpChatStream(input: {
    reader: ReadableStreamDefaultReader<Uint8Array>
    decoder: TextDecoder
    encoder: TextEncoder
    state: ChatStreamState
    getBuffer: () => string
    setBuffer: (value: string) => void
    controller: ReadableStreamDefaultController<Uint8Array>
    onComplete?: (response: JsonObject) => void
    close: () => void
}) {
    const finish = async (cancelUpstream: boolean) => {
        const final = input.state.finalize()
        for (const event of final.events) input.controller.enqueue(input.encoder.encode(event))
        input.onComplete?.(final.response)
        if (cancelUpstream) await input.reader.cancel()
        input.close()
        input.controller.close()
    }

    while (true) {
        const { done, value } = await input.reader.read()
        let buffer = input.getBuffer()
        if (value) buffer += input.decoder.decode(value, { stream: !done })
        const blocks = takeSseBlocks(buffer)
        input.setBuffer(blocks.remainder)

        for (const block of blocks.blocks) {
            if (isDoneSseBlock(block)) {
                await finish(true)
                return
            }
            for (const event of input.state.consume(block)) {
                input.controller.enqueue(input.encoder.encode(event))
            }
        }

        if (!done) continue

        buffer = input.getBuffer()
        if (buffer.trim()) {
            for (const event of input.state.consume(buffer)) {
                input.controller.enqueue(input.encoder.encode(event))
            }
            input.setBuffer('')
        }
        await finish(false)
        return
    }
}

class ChatStreamState {
    private started = false
    private completed = false
    private responseId = `resp_${crypto.randomUUID()}`
    private model = ''
    private createdAt = Math.floor(Date.now() / 1000)
    private nextOutputIndex = 0
    private textIndex: number | null = null
    private textItemId = ''
    private text = ''
    private reasoningIndex: number | null = null
    private reasoningItemId = ''
    private reasoning = ''
    private usage: JsonObject = chatUsageToResponses(null)
    private finishReason = ''
    private readonly tools = new Map<number, ToolState>()
    private readonly output: Array<{ index: number; item: JsonObject }> = []

    constructor(private readonly context: CodexToolContext) {}

    consume(block: string) {
        const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
        if (!data || data === '[DONE]') return []
        let chunk: JsonObject
        try {
            const parsed = JSON.parse(data) as unknown
            if (!isObject(parsed)) return []
            chunk = parsed
        } catch {
            return []
        }
        if (isObject(chunk.error)) {
            this.completed = true
            return [sse('response.failed', {
                type: 'response.failed',
                response: { ...this.baseResponse('failed'), error: chunk.error },
            })]
        }

        if (typeof chunk.id === 'string') this.responseId = responseIdFromChat(chunk.id)
        if (typeof chunk.model === 'string') this.model = chunk.model
        if (typeof chunk.created === 'number') this.createdAt = chunk.created
        if (chunk.usage !== undefined) this.usage = chatUsageToResponses(chunk.usage)

        const events = this.ensureStarted()
        const choice = Array.isArray(chunk.choices) && isObject(chunk.choices[0]) ? chunk.choices[0] : null
        const delta = choice && isObject(choice.delta) ? choice.delta : null
        if (delta) {
            const reasoning = extractReasoning(delta)
            if (reasoning) events.push(...this.pushReasoning(reasoning))
            if (typeof delta.content === 'string' && delta.content) {
                events.push(...this.pushText(stripLeadingThink(delta.content)))
            }
            if (Array.isArray(delta.tool_calls)) {
                for (const toolCall of delta.tool_calls) {
                    if (isObject(toolCall)) events.push(...this.pushTool(toolCall))
                }
            }
        }
        if (choice && typeof choice.finish_reason === 'string') this.finishReason = choice.finish_reason
        return events
    }

    finalize() {
        if (this.completed) return { events: [], response: this.baseResponse('failed') }
        const events = this.ensureStarted()
        if (this.reasoningIndex !== null) events.push(...this.finishReasoning())
        if (this.textIndex !== null) events.push(...this.finishText())
        events.push(...this.finishTools())
        const status = this.finishReason === 'length' ? 'incomplete' : 'completed'
        const response = this.baseResponse(status)
        if (status === 'incomplete') response.incomplete_details = { reason: 'max_output_tokens' }
        events.push(sse('response.completed', { type: 'response.completed', response }))
        this.completed = true
        return { events, response }
    }

    private ensureStarted() {
        if (this.started) return []
        this.started = true
        return [
            sse('response.created', { type: 'response.created', response: this.baseResponse('in_progress', []) }),
            sse('response.in_progress', { type: 'response.in_progress', response: this.baseResponse('in_progress', []) }),
        ]
    }

    private pushReasoning(delta: string) {
        const events: string[] = []
        if (this.reasoningIndex === null) {
            this.reasoningIndex = this.nextIndex()
            this.reasoningItemId = `rs_${this.responseId}`
            events.push(sse('response.output_item.added', {
                type: 'response.output_item.added',
                output_index: this.reasoningIndex,
                item: { id: this.reasoningItemId, type: 'reasoning', status: 'in_progress', summary: [] },
            }))
            events.push(sse('response.reasoning_summary_part.added', {
                type: 'response.reasoning_summary_part.added',
                item_id: this.reasoningItemId,
                output_index: this.reasoningIndex,
                summary_index: 0,
                part: { type: 'summary_text', text: '' },
            }))
        }
        this.reasoning += delta
        events.push(sse('response.reasoning_summary_text.delta', {
            type: 'response.reasoning_summary_text.delta',
            item_id: this.reasoningItemId,
            output_index: this.reasoningIndex,
            summary_index: 0,
            delta,
        }))
        return events
    }

    private pushText(delta: string) {
        if (!delta) return []
        const events: string[] = []
        if (this.textIndex === null) {
            this.textIndex = this.nextIndex()
            this.textItemId = `${this.responseId}_msg`
            events.push(sse('response.output_item.added', {
                type: 'response.output_item.added',
                output_index: this.textIndex,
                item: { id: this.textItemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
            }))
            events.push(sse('response.content_part.added', {
                type: 'response.content_part.added',
                item_id: this.textItemId,
                output_index: this.textIndex,
                content_index: 0,
                part: { type: 'output_text', text: '', annotations: [] },
            }))
        }
        this.text += delta
        events.push(sse('response.output_text.delta', {
            type: 'response.output_text.delta',
            item_id: this.textItemId,
            output_index: this.textIndex,
            content_index: 0,
            delta,
        }))
        return events
    }

    private pushTool(value: JsonObject) {
        const index = typeof value.index === 'number' ? value.index : 0
        const fn = isObject(value.function) ? value.function : {}
        const state = this.tools.get(index) ?? {
            outputIndex: -1,
            itemId: '',
            callId: '',
            name: '',
            arguments: '',
            added: false,
        }
        if (typeof value.id === 'string') state.callId = value.id
        if (typeof fn.name === 'string') state.name = fn.name
        const argumentDelta = typeof fn.arguments === 'string' ? fn.arguments : ''
        state.arguments += argumentDelta
        const events: string[] = []
        if (!state.added && state.name) {
            if (!state.callId) state.callId = `call_${index}`
            state.outputIndex = this.nextIndex()
            state.itemId = responseItemId(state.callId, state.name, this.context)
            state.added = true
            events.push(sse('response.output_item.added', {
                type: 'response.output_item.added',
                output_index: state.outputIndex,
                item: responseItemFromChatToolCall({
                    callId: state.callId,
                    chatName: state.name,
                    arguments: '',
                    status: 'in_progress',
                    context: this.context,
                    reasoning: this.reasoning,
                }),
            }))
        }
        if (state.added && argumentDelta && !this.context.isCustom(state.name)) {
            events.push(sse('response.function_call_arguments.delta', {
                type: 'response.function_call_arguments.delta',
                item_id: state.itemId,
                output_index: state.outputIndex,
                delta: argumentDelta,
            }))
        }
        this.tools.set(index, state)
        return events
    }

    private finishReasoning() {
        const index = this.reasoningIndex!
        const item = { id: this.reasoningItemId, type: 'reasoning', summary: [{ type: 'summary_text', text: this.reasoning }] }
        this.output.push({ index, item })
        return [
            sse('response.reasoning_summary_text.done', { type: 'response.reasoning_summary_text.done', item_id: this.reasoningItemId, output_index: index, summary_index: 0, text: this.reasoning }),
            sse('response.reasoning_summary_part.done', { type: 'response.reasoning_summary_part.done', item_id: this.reasoningItemId, output_index: index, summary_index: 0, part: { type: 'summary_text', text: this.reasoning } }),
            sse('response.output_item.done', { type: 'response.output_item.done', output_index: index, item }),
        ]
    }

    private finishText() {
        const index = this.textIndex!
        const item = { id: this.textItemId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: this.text, annotations: [] }] }
        this.output.push({ index, item })
        return [
            sse('response.output_text.done', { type: 'response.output_text.done', item_id: this.textItemId, output_index: index, content_index: 0, text: this.text }),
            sse('response.content_part.done', { type: 'response.content_part.done', item_id: this.textItemId, output_index: index, content_index: 0, part: item.content[0] }),
            sse('response.output_item.done', { type: 'response.output_item.done', output_index: index, item }),
        ]
    }

    private finishTools() {
        const events: string[] = []
        for (const state of [...this.tools.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
            if (!state.name) continue
            if (!state.added) {
                state.outputIndex = this.nextIndex()
                if (!state.callId) state.callId = `call_${state.outputIndex}`
                state.itemId = responseItemId(state.callId, state.name, this.context)
                state.added = true
                events.push(sse('response.output_item.added', {
                    type: 'response.output_item.added',
                    output_index: state.outputIndex,
                    item: responseItemFromChatToolCall({ callId: state.callId, chatName: state.name, arguments: '', status: 'in_progress', context: this.context, reasoning: this.reasoning }),
                }))
            }
            const argumentsValue = canonicalArguments(state.arguments)
            const item = responseItemFromChatToolCall({
                callId: state.callId,
                chatName: state.name,
                arguments: argumentsValue,
                status: 'completed',
                context: this.context,
                reasoning: this.reasoning,
            })
            if (this.context.isCustom(state.name)) {
                const input = customInput(argumentsValue)
                if (input) events.push(sse('response.custom_tool_call_input.delta', { type: 'response.custom_tool_call_input.delta', item_id: state.itemId, output_index: state.outputIndex, delta: input }))
                events.push(sse('response.custom_tool_call_input.done', { type: 'response.custom_tool_call_input.done', item_id: state.itemId, output_index: state.outputIndex, input }))
            } else {
                events.push(sse('response.function_call_arguments.done', { type: 'response.function_call_arguments.done', item_id: state.itemId, output_index: state.outputIndex, arguments: argumentsValue }))
            }
            events.push(sse('response.output_item.done', { type: 'response.output_item.done', output_index: state.outputIndex, item }))
            this.output.push({ index: state.outputIndex, item })
        }
        return events
    }

    private baseResponse(status: string, output = this.output.sort((a, b) => a.index - b.index).map((entry) => entry.item)): JsonObject {
        return {
            id: this.responseId,
            object: 'response',
            created_at: this.createdAt,
            status,
            model: this.model,
            output,
            usage: this.usage,
        }
    }

    private nextIndex() {
        const value = this.nextOutputIndex
        this.nextOutputIndex += 1
        return value
    }
}

function takeSseBlocks(value: string) {
    const normalized = value.replace(/\r\n/g, '\n')
    const parts = normalized.split('\n\n')
    const remainder = parts.pop() ?? ''
    return { blocks: parts.filter((part) => part.trim()), remainder }
}

function isDoneSseBlock(block: string) {
    return block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim() === '[DONE]'
}

function responseIdFromChat(value: string) {
    return value.startsWith('resp_') ? value : `resp_${value.replace(/^chatcmpl[_-]?/, '')}`
}

function sse(event: string, data: JsonObject) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
