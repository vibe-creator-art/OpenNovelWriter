import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createAnthropicToResponsesStream } from './anthropic-stream'
import { anthropicResponseToResponses, responsesToAnthropicRequest } from './anthropic-transform'
import { codexBridgeHistory } from './history'
import { CodexToolContext } from './tool-context'

describe('Responses and Anthropic Messages conversion', () => {
    test('converts Codex namespaces, history, tools, and reasoning settings', () => {
        const body = {
            model: 'claude-sonnet-4-6',
            instructions: 'Follow the repository instructions.',
            reasoning: { effort: 'high' },
            max_output_tokens: 8192,
            stream: true,
            input: [
                {
                    type: 'additional_tools',
                    tools: [{
                        type: 'namespace',
                        name: 'workspace',
                        tools: [{ type: 'function', name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
                    }],
                },
                { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect the file.' }] },
                { type: 'function_call', call_id: 'call_1', name: 'read_file', namespace: 'workspace', arguments: '{"path":"README.md"}' },
                { type: 'function_call_output', call_id: 'call_1', output: 'contents' },
            ],
        }
        const context = CodexToolContext.fromRequest(body)

        const result = responsesToAnthropicRequest(body, context)

        assert.equal(result.model, 'claude-sonnet-4-6')
        assert.equal(result.system, 'Follow the repository instructions.')
        assert.equal(result.thinking, undefined)
        assert.equal((result.tools as Array<{ name: string }>)[0].name, 'workspace__read_file')
        assert.deepEqual(result.messages, [
            { role: 'user', content: [{ type: 'text', text: 'Inspect the file.' }] },
            { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'workspace__read_file', input: { path: 'README.md' } }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'contents' }] },
        ])
    })

    test('converts Anthropic thinking, text, tool calls, and cache usage back to Responses', () => {
        const request = {
            tools: [{ type: 'namespace', name: 'workspace', tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object' } }] }],
        }
        const context = CodexToolContext.fromRequest(request)
        const result = anthropicResponseToResponses({
            id: 'msg_123',
            type: 'message',
            model: 'claude-sonnet-4-6',
            stop_reason: 'tool_use',
            content: [
                { type: 'thinking', thinking: 'I should inspect it.', signature: 'signed' },
                { type: 'text', text: 'I will inspect the file.' },
                { type: 'tool_use', id: 'call_1', name: 'workspace__read_file', input: { path: 'README.md' } },
            ],
            usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 7 },
        }, context)

        assert.equal(result.id, 'resp_msg_123')
        assert.equal(result.status, 'completed')
        assert.deepEqual(result.usage, {
            input_tokens: 35,
            output_tokens: 7,
            total_tokens: 42,
            output_tokens_details: { reasoning_tokens: 0 },
            input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
        })
        const output = result.output as Array<Record<string, unknown>>
        assert.equal(output[0].type, 'reasoning')
        assert.match(String(output[0].encrypted_content), /^opennovelwriter-anthropic-thinking-v1:/)
        assert.equal(output[1].type, 'message')
        assert.deepEqual(output[2], {
            id: 'fc_call_1',
            type: 'function_call',
            status: 'completed',
            call_id: 'call_1',
            name: 'read_file',
            namespace: 'workspace',
            arguments: '{"path":"README.md"}',
        })
    })

    test('replays signed thinking before an Anthropic tool-result continuation', () => {
        const context = CodexToolContext.fromRequest({ tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }] })
        const response = anthropicResponseToResponses({
            id: 'msg_1',
            model: 'claude-sonnet-4-6',
            stop_reason: 'tool_use',
            content: [
                { type: 'thinking', thinking: 'Need a lookup.', signature: 'signed' },
                { type: 'tool_use', id: 'call_1', name: 'lookup', input: { q: 'value' } },
            ],
            usage: {},
        }, context)
        const followUp = responsesToAnthropicRequest({
            model: 'claude-sonnet-4-6',
            reasoning: { effort: 'high' },
            input: [
                ...(response.output as unknown[]),
                { type: 'function_call_output', call_id: 'call_1', output: 'answer' },
            ],
        }, context)

        const messages = followUp.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
        assert.equal(messages[1].role, 'assistant')
        assert.equal(messages[1].content[0].type, 'thinking')
        assert.equal(messages[1].content[1].type, 'tool_use')
        assert.equal(messages[2].content[0].type, 'tool_result')
        assert.deepEqual(followUp.thinking, { type: 'enabled', budget_tokens: 4096 })
    })

    test('disables thinking for a tool continuation without a signed thinking block', () => {
        const context = CodexToolContext.fromRequest({ tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }] })
        const result = responsesToAnthropicRequest({
            model: 'claude-sonnet-4-6',
            reasoning: { effort: 'high' },
            input: [
                { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"q":"value"}' },
                { type: 'function_call_output', call_id: 'call_1', output: 'answer' },
            ],
        }, context)

        assert.equal(result.thinking, undefined)
    })

    test('restores signed thinking together with a cached tool call', () => {
        const context = CodexToolContext.fromRequest({ tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }] })
        const response = anthropicResponseToResponses({
            id: 'msg_cached',
            model: 'claude-sonnet-4-6',
            stop_reason: 'tool_use',
            content: [
                { type: 'thinking', thinking: 'Need a lookup.', signature: 'signed' },
                { type: 'tool_use', id: 'call_cached', name: 'lookup', input: { q: 'value' } },
            ],
            usage: {},
        }, context)
        codexBridgeHistory.record(response)

        const enriched = codexBridgeHistory.enrich({
            previous_response_id: response.id,
            input: [{ type: 'function_call_output', call_id: 'call_cached', output: 'answer' }],
        })
        const items = enriched.input as Array<Record<string, unknown>>
        assert.deepEqual(items.map((item) => item.type), ['reasoning', 'function_call', 'function_call_output'])
    })

    test('converts Anthropic SSE into live Responses events', async () => {
        const upstreamText = [
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream","model":"claude-sonnet-4-6","usage":{"input_tokens":3,"output_tokens":0}}}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ].join('')
        const upstream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(upstreamText))
                controller.close()
            },
        })
        const stream = createAnthropicToResponsesStream({ upstream, context: CodexToolContext.fromRequest({}) })
        const text = await new Response(stream).text()

        assert.match(text, /event: response\.output_text\.delta/)
        assert.match(text, /"delta":"hello"/)
        assert.match(text, /event: response\.completed/)
        assert.match(text, /"input_tokens":3/)
        assert.match(text, /"output_tokens":2/)
    })
})
