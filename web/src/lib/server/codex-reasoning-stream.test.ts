import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CodexReasoningStream } from './codex-reasoning-stream'

test('reasoning sections stream in order and completion replaces the accumulated text', () => {
    const stream = new CodexReasoningStream()
    const first = stream.consume('item/reasoning/summaryTextDelta', { itemId: 'r1', summaryIndex: 0, delta: 'Consider' })!
    assert.equal(first.type, 'delta')
    assert.equal(stream.consume('item/reasoning/summaryPartAdded', { itemId: 'r1', summaryIndex: 1 })?.type, 'delta')
    const second = stream.consume('item/reasoning/summaryTextDelta', { itemId: 'r1', summaryIndex: 1, delta: 'the scene' })!
    assert.equal(second.type, 'delta')
    if (second.type === 'delta') assert.equal(second.value.delta, 'the scene')
    const completed = stream.consume('item/completed', { item: { id: 'r1', type: 'reasoning', summary: ['Consider', 'the complete scene'], content: [] } })!
    assert.equal(completed.type, 'event')
    if (completed.type === 'event') {
        assert.equal(completed.value.content, 'Consider\n\nthe complete scene')
        assert.equal(completed.value.workStatus, 'completed')
    }
    assert.equal(completed.value.createdAt, first.value.createdAt)
})

test('raw reasoning replaces a summary while independent reasoning items remain separate', () => {
    const stream = new CodexReasoningStream()
    stream.consume('item/reasoning/summaryTextDelta', { itemId: 'r1', summaryIndex: 0, delta: 'Summary' })
    const raw = stream.consume('item/reasoning/textDelta', { itemId: 'r1', contentIndex: 0, delta: 'Full reasoning' })!
    assert.equal(raw.type, 'event')
    if (raw.type === 'event') assert.equal(raw.value.content, 'Full reasoning')
    assert.equal(stream.consume('item/reasoning/summaryTextDelta', { itemId: 'r1', summaryIndex: 0, delta: ' continues' }), null)
    const other = stream.consume('item/reasoning/textDelta', { itemId: 'r2', contentIndex: 0, delta: 'Next thought' })!
    if (other.type === 'delta') assert.equal(other.value.delta, 'Next thought')
    const done = stream.consume('item/completed', { item: { id: 'r1', type: 'reasoning', summary: ['Summary'], content: ['Full reasoning'] } })!
    if (done.type === 'event') assert.equal(done.value.content, 'Full reasoning')
    assert.equal(stream.consume('item/agentMessage/delta', { delta: 'Answer' }), null)
})

test('completed-only reasoning is captured and an empty reasoning item stays empty', () => {
    const stream = new CodexReasoningStream()
    for (const text of ['', 'Provider supplied text']) {
        const result = stream.consume('item/completed', { item: { type: 'reasoning', id: text || 'empty', summary: [text], content: [] } })!
        assert.equal(result.type, 'event')
        if (result.type === 'event') assert.equal(result.value.content, text)
    }
})
