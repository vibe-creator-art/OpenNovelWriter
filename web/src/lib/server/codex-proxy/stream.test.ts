import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatToResponsesStream } from './stream'
import { CodexToolContext } from './tool-context'

async function convert(deltas: Record<string, unknown>[]) {
    const encoder = new TextEncoder()
    const upstream = new ReadableStream<Uint8Array>({ start(controller) {
        for (const delta of deltas) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'chatcmpl-test', choices: [{ delta }] })}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
    } })
    const response = await new Response(createChatToResponsesStream({ upstream, context: CodexToolContext.fromRequest({}) })).text()
    return response.split('\n\n').flatMap((block) => {
        const data = block.split('\n').find((line) => line.startsWith('data: '))
        return data ? [JSON.parse(data.slice(6))] : []
    })
}

test('think tags split at every position keep reasoning out of the answer', async () => {
    const text = '  <think>Consider the scene.\nUse dialogue.</think>Final answer'
    const partitions = [Array.from(text), ...Array.from({ length: text.length - 1 }, (_, i) => [text.slice(0, i + 1), text.slice(i + 1)])]
    for (const chunks of partitions) {
        const events = await convert(chunks.map((content) => ({ content })))
        assert.equal(events.filter((e) => e.type === 'response.reasoning_summary_text.delta').map((e) => e.delta).join(''), 'Consider the scene.\nUse dialogue.')
        assert.equal(events.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta).join(''), 'Final answer')
        const output = events.at(-1).response.output
        assert.equal(output.find((item: { type: string }) => item.type === 'reasoning').summary[0].text, 'Consider the scene.\nUse dialogue.')
    }
})

test('reasoning fields retain whitespace and ordinary answer tags remain literal', async () => {
    for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
        const events = await convert([{ [key]: 'First' }, { [key]: ' ' }, { [key]: 'thought' }, { content: 'Explain <think> literally.' }])
        assert.equal(events.filter((e) => e.type === 'response.reasoning_summary_text.delta').map((e) => e.delta).join(''), 'First thought')
        assert.equal(events.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta).join(''), 'Explain <think> literally.')
    }
})

test('unfinished thinking remains reasoning when the upstream ends', async () => {
    const events = await convert([{ content: '<think>' }, { content: 'unfinished </thi' }])
    assert.equal(events.filter((e) => e.type === 'response.reasoning_summary_text.delta').map((e) => e.delta).join(''), 'unfinished </thi')
    assert.equal(events.filter((e) => e.type === 'response.output_text.delta').length, 0)
})
