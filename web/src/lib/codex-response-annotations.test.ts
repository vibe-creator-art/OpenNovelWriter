import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
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
})
