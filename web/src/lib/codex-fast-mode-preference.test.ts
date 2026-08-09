import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { CodexModelCatalogEntry } from '@/lib/api'
import { resolvePreferredCodexServiceTier } from '@/lib/codex-fast-mode-preference'

function createModel(serviceTierNames: string[]): CodexModelCatalogEntry {
    return {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        description: '',
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high',
        serviceTiers: serviceTierNames.map((name) => ({ id: name, name, description: '' })),
    }
}

describe('resolvePreferredCodexServiceTier', () => {
    test('enables fast for a supported model', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: true,
            models: [createModel(['fast'])],
            modelId: 'gpt-5.6-sol',
        }), 'fast')
    })

    test('keeps standard when the user preference is off', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: false,
            models: [createModel(['fast'])],
            modelId: 'gpt-5.6-sol',
        }), 'standard')
    })

    test('keeps standard when the default model has no fast tier', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: true,
            models: [createModel([])],
            modelId: 'gpt-5.6-sol',
        }), 'standard')
    })
})
