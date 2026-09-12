import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAstraCodexModelId } from './codex-config'

test('recognizes Astra model IDs with provider prefixes and version suffixes', () => {
    for (const id of ['gpt-6-astra', 'openai/gpt-6-astra', ' GPT-6-ASTRA ', 'gpt-6-astra-2026-09-03', 'gpt-6-astra:fast']) {
        assert.equal(isAstraCodexModelId(id), true, id)
    }
    for (const id of ['gpt-5.6-sol', 'gpt-5.5', 'deepseek-v4-flash', 'astra', 'gpt-6-astral', 'not-gpt-6-astra']) {
        assert.equal(isAstraCodexModelId(id), false, id)
    }
})
