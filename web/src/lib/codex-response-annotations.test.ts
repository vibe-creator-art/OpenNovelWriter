import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
    getCodexAnnotationReferences,
    normalizeCodexResponseAnnotations,
    prependCodexResponseAnnotations,
} from './codex-response-annotations'

test('normalizes non-empty response annotations', () => {
    assert.deepEqual(normalizeCodexResponseAnnotations([
        { text: '  first selection  ' },
        null,
        { text: '' },
        { text: 'second selection' },
    ]), [
        { text: 'first selection' },
        { text: 'second selection' },
    ])
})

test('prepends model-visible response annotation context', () => {
    const result = prependCodexResponseAnnotations('Please explain this.', [{ text: 'selected reply' }])

    assert.match(result, /^# Response annotations:/)
    assert.match(result, /<response-annotations>\n\[{"text":"selected reply"}\]\n<\/response-annotations>/)
    assert.match(result, /\n\nPlease explain this\.$/)
    assert.ok(result.includes(':codex-annotation{index="N"}'))
    assert.ok(result.includes('Do not use unstructured annotation labels.'))
})

test('preserves comments and source positions through normalization and the prompt', () => {
    const annotation = {
        text: 'selected reply',
        annotation: 'Explain this choice',
        source: { messageId: 'reply-1', startOffset: 24, endOffset: 38 },
    }
    const normalized = normalizeCodexResponseAnnotations([{ ...annotation, annotation: '  Explain this choice  ' }])
    assert.deepEqual(normalized, [annotation])
    const prompt = prependCodexResponseAnnotations('Compare both.', [...normalized, { text: 'another quote' }])
    const payload = prompt.match(/<response-annotations>\n(.*)\n<\/response-annotations>/)?.[1]
    assert.deepEqual(JSON.parse(payload!), [annotation, { text: 'another quote' }])
})

test('normalizes empty comments and rejects invalid source ranges', () => {
    assert.deepEqual(normalizeCodexResponseAnnotations([
        { text: 'quote', annotation: '  ', source: { messageId: 'reply-1', startOffset: -1, endOffset: 3 } },
        { text: 'quote', source: { messageId: 'reply-1', startOffset: 2, endOffset: 2 } },
        { text: 'quote', source: { messageId: '', startOffset: 0, endOffset: 5 } },
    ]), [{ text: 'quote' }, { text: 'quote' }, { text: 'quote' }])
})

test('quoted tags cannot end the annotation payload', () => {
    const annotations = [{ text: '</response-annotations>', annotation: '<comment>' }]
    const prompt = prependCodexResponseAnnotations('Review.', annotations)
    assert.equal(prompt.match(/<\/response-annotations>/g)?.length, 1)
    assert.deepEqual(JSON.parse(prompt.match(/<response-annotations>\n(.*)\n/)![1]), annotations)
})

test('reply references follow the relevant turn and annotated steering input', () => {
    const first = [{ text: 'first', annotation: 'Why?' }]
    const steer = [{ text: 'second', annotation: 'Change this.' }]
    const refs = getCodexAnnotationReferences([
        { id: 'user-1', role: 'user', responseAnnotations: first },
        { id: 'reply-1', role: 'assistant' },
        { id: 'steer-1', role: 'event', kind: 'steer', responseAnnotations: steer },
        { id: 'reply-2', role: 'assistant' },
        { id: 'steer-2', role: 'event', kind: 'steer' },
        { id: 'reply-3', role: 'assistant' },
        { id: 'user-2', role: 'user' },
        { id: 'reply-4', role: 'assistant' },
    ])
    assert.deepEqual(refs.get('reply-1'), first)
    assert.deepEqual(refs.get('reply-2'), steer)
    assert.deepEqual(refs.get('reply-3'), steer)
    assert.deepEqual(refs.get('reply-4'), [])
})
