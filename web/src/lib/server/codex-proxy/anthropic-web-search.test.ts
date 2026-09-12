import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createAnthropicToResponsesStream, readAnthropicSseAsResponses } from './anthropic-stream'
import { anthropicResponseToResponses, responsesToAnthropicRequest } from './anthropic-transform'
import { AnthropicWebCitations, needsAnthropicSearchContinuation } from './anthropic-web-search'
import { CodexToolContext } from './tool-context'
import { sse, sseData, takeSseBlocks } from './sse'

type JsonObject = Record<string, unknown>
const call = { type: 'server_tool_use', id: 'search_1', name: 'web_search', input: { query: '任天堂 发售日期' } }
const result = {
    type: 'web_search_tool_result', tool_use_id: 'search_1',
    content: [{ type: 'web_search_result', title: '任天堂公告', url: 'https://www.nintendo.com/news', encrypted_content: 'opaque-source' }],
}
const citation = { type: 'web_search_result_location', url: 'https://www.nintendo.com/news', title: '任天堂公告' }
const context = CodexToolContext.fromRequest({})

function upstreamMessage(id: string, content: JsonObject[], stopReason = 'end_turn') {
    return { id, type: 'message', model: 'deepseek-flash', content, stop_reason: stopReason, usage: { input_tokens: 5, output_tokens: 2 } }
}

function messageEvents(id: string, content: JsonObject[], stopReason = 'end_turn'): JsonObject[] {
    return [
        { type: 'message_start', message: { id, model: 'deepseek-flash', usage: { input_tokens: 5, output_tokens: 0 } } },
        ...content.flatMap((block, index) => [
            { type: 'content_block_start', index, content_block: block },
            { type: 'content_block_stop', index },
        ]),
        { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
    ]
}

function eventStream(events: JsonObject[]) {
    const bytes = new TextEncoder().encode(events.map((event) => sse(String(event.type), event)).join(''))
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17))
            controller.close()
        },
    })
}

test('maps hosted search only when enabled, preserving ordinary tools and a forced search choice', () => {
    const body = {
        model: 'deepseek-flash', input: 'Search the web.', max_tool_calls: 2, tool_choice: { type: 'web_search' },
        tools: [{ type: 'web_search', filters: { allowed_domains: ['nintendo.com'] } }, { type: 'function', name: 'read_file', parameters: { type: 'object' } }],
    }
    const context = CodexToolContext.fromRequest(body)
    const enabled = responsesToAnthropicRequest(body, context, { webSearch: true })
    assert.deepEqual((enabled.tools as JsonObject[])[1], { type: 'web_search_20250305', name: 'web_search', allowed_domains: ['nintendo.com'], max_uses: 2 })
    assert.deepEqual(enabled.tool_choice, { type: 'tool', name: 'web_search' })
    assert.equal(enabled.thinking, undefined)
    assert.equal((responsesToAnthropicRequest(body, context).tools as JsonObject[]).length, 1)
    assert.equal(responsesToAnthropicRequest({ ...body, tools: [] }, CodexToolContext.fromRequest({}), { webSearch: true }).tools, undefined)
})

test('converts hosted searches and citations, and replays opaque search results in a new turn', () => {
    const response = anthropicResponseToResponses(upstreamMessage('search_response', [call, result, { type: 'text', text: '九月发售。', citations: [citation] }]), context)
    assert.deepEqual(response.output.map((item) => item.type), ['web_search_call', 'reasoning', 'message'])
    assert.equal(response.output[0].status, 'completed')
    assert.deepEqual(response.output[0].action, { type: 'search', query: '任天堂 发售日期', queries: ['任天堂 发售日期'] })
    assert.equal((response.output[2].content as JsonObject[])[0].text, '九月发售。[[1]](https://www.nintendo.com/news)')
    const request = responsesToAnthropicRequest({ model: 'deepseek-flash', input: [
        { role: 'user', content: 'Search.' }, ...response.output, { role: 'user', content: 'Explain the announcement.' },
    ] }, context)
    const messages = request.messages as Array<{ content: JsonObject[] }>
    assert.deepEqual(messages[1].content.slice(0, 2), [call, result])
    assert.equal(messages[1].content.filter((block) => block.type === 'server_tool_use').length, 1)
})

test('streams search progress, fragmented arguments, and numbered citation deltas', async () => {
    const events = messageEvents('stream_search', [])
    events.splice(1, 0,
        { type: 'content_block_start', index: 0, content_block: { ...call, input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"任天堂' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ' 发售日期"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: result },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: '九月发售。' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation } },
        { type: 'content_block_stop', index: 2 },
    )
    const text = await new Response(createAnthropicToResponsesStream({ upstream: eventStream(events), context })).text()
    const parsed = takeSseBlocks(text).blocks.map((block) => JSON.parse(sseData(block)))
    assert.ok(parsed.some((event) => event.type === 'response.web_search_call.searching'))
    assert.ok(parsed.some((event) => event.type === 'response.web_search_call.completed'))
    assert.equal(parsed.filter((event) => event.type === 'response.completed').length, 1)
    const output = parsed.at(-1).response.output
    assert.equal(output[0].action.query, call.input.query)
    assert.equal(output[2].content[0].text, '九月发售。[[1]](https://www.nintendo.com/news)')
    assert.equal(parsed.filter((event) => event.type === 'response.output_text.delta').map((event) => event.delta).join(''), output[2].content[0].text)
})

for (const stopReason of ['tool_use', 'pause_turn']) {
    test(`continues ${stopReason} search responses as one Responses stream with unique items and summed usage`, async () => {
        let continued = 0
        const final = await readAnthropicSseAsResponses({
            upstream: eventStream(messageEvents('first', [{ type: 'text', text: '正在搜索。' }, call, result], stopReason)),
            context,
            continueMessage: async (message) => {
                continued++
                assert.deepEqual(message, { role: 'assistant', content: [{ type: 'text', text: '正在搜索。' }, call, result] })
                return eventStream(messageEvents('second', [{ type: 'text', text: '九月发售。', citations: [citation] }]))
            },
        })
        assert.equal(continued, 1)
        assert.equal(final.id, 'resp_first')
        const output = final.output as JsonObject[]
        assert.equal(new Set(output.map((item) => item.id)).size, output.length)
        assert.equal((output.at(-1)?.content as JsonObject[])[0].text, '九月发售。[[1]](https://www.nintendo.com/news)')
        assert.equal((final.usage as JsonObject).input_tokens, 10)
        assert.equal((final.usage as JsonObject).output_tokens, 4)
    })
}

test('marks search errors as failed and leaves client tool continuations to Codex', async () => {
    for (const content of [{ type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }, [{ type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }]]) {
        const final = await readAnthropicSseAsResponses({ upstream: eventStream(messageEvents('failed', [call, { ...result, content }])), context })
        assert.equal((final.output as JsonObject[])[0].status, 'failed')
    }
    assert.equal(needsAnthropicSearchContinuation('tool_use', [call, result, { type: 'tool_use', id: 'read_1', name: 'read_file', input: {} }]), false)
    const response = await readAnthropicSseAsResponses({
        upstream: eventStream(messageEvents('client_tool', [call, result, { type: 'tool_use', id: 'list_1', name: 'list_files', input: {} }], 'tool_use')),
        context,
        continueMessage: async () => { throw new Error('Client tools must be handled by Codex.') },
    })
    assert.equal((response.output as JsonObject[]).at(-1)?.type, 'function_call')
})

test('limits server continuations that never produce an answer', async () => {
    let continued = 0
    await assert.rejects(readAnthropicSseAsResponses({
        upstream: eventStream(messageEvents('repeat', [call, result], 'pause_turn')), context,
        continueMessage: async () => {
            continued++
            return eventStream(messageEvents(`repeat_${continued}`, [{ ...call, id: `search_${continued + 1}` }, { ...result, tool_use_id: `search_${continued + 1}` }], 'pause_turn'))
        },
    }), /continuation limit/)
    assert.equal(continued, 10)
})

test('numbers native citations around existing Markdown references without unsafe links', () => {
    const citations = new AnthropicWebCitations()
    const text = 'Existing [[3]](https://example.com/news)'
    assert.equal(citations.render([citation], text), '[[4]](https://www.nintendo.com/news)')
    assert.equal(citations.render([citation], ''), '[[4]](https://www.nintendo.com/news)')
    assert.equal(citations.render([citation], 'Source [[4]](https://www.nintendo.com/news)'), '')
    assert.equal(citations.render([{ ...citation, url: 'javascript:alert(1)' }], ''), '')
})
