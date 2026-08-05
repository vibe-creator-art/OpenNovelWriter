import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createResponsesToolStream } from './responses-stream'
import { CodexToolContext } from './tool-context'

test('rewrites streamed function tool_search calls to native Codex items', async () => {
    const context = CodexToolContext.fromRequest({
        tools: [{
            type: 'tool_search',
            execution: 'client',
            description: 'Search tools.',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
        }],
    })
    const upstreamItem = {
        type: 'function_call',
        id: 'fc_search_1',
        call_id: 'search_1',
        status: 'completed',
        name: 'tool_search',
        arguments: '{"query":"rename chapter"}',
    }
    const encoded = new TextEncoder().encode([
        'event: response.output_item.done',
        `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: upstreamItem })}`,
        '',
        'event: response.completed',
        `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', output: [upstreamItem] } })}`,
        '',
        '',
    ].join('\n'))
    const upstream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encoded)
            controller.close()
        },
    })

    const output = await readStream(createResponsesToolStream({ upstream, context }))
    const payloads = output
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)

    const doneItem = payloads[0].item as Record<string, unknown>
    assert.deepEqual(doneItem, {
        type: 'tool_search_call',
        call_id: 'search_1',
        status: 'completed',
        execution: 'client',
        arguments: { query: 'rename chapter' },
    })
    const completedResponse = payloads[1].response as { output: Array<Record<string, unknown>> }
    assert.equal(completedResponse.output[0].type, 'tool_search_call')
})

async function readStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let output = ''
    while (true) {
        const { done, value } = await reader.read()
        if (value) output += decoder.decode(value, { stream: !done })
        if (done) return output
    }
}
