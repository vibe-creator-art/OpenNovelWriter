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

const officialConnection = { providerType: 'openai-official' as const, authStatus: 'authenticated', authType: 'chatgpt' }
const customConnection = { providerType: 'custom' as const, authStatus: 'authenticated', authType: 'apiKey' }

describe('resolvePreferredCodexServiceTier', () => {
    test('enables fast for a supported model', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: true,
            connection: officialConnection,
            customFastModeEnabled: false,
            models: [createModel(['fast'])],
            modelId: 'gpt-5.6-sol',
        }), 'fast')
    })

    test('keeps standard when the user preference is off', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: false,
            connection: officialConnection,
            customFastModeEnabled: false,
            models: [createModel(['fast'])],
            modelId: 'gpt-5.6-sol',
        }), 'standard')
    })

    test('keeps standard when the default model has no fast tier', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: true,
            connection: officialConnection,
            customFastModeEnabled: false,
            models: [createModel([])],
            modelId: 'gpt-5.6-sol',
        }), 'standard')
    })

    for (const customFastModeEnabled of [false, true]) {
        test(`third-party fast preference respects permission ${customFastModeEnabled}`, () => {
            assert.equal(resolvePreferredCodexServiceTier({
                enabled: true,
                connection: customConnection,
                customFastModeEnabled,
                models: [createModel(['fast'])],
                modelId: 'gpt-5.6-sol',
            }), customFastModeEnabled ? 'fast' : 'standard')
        })
    }

    test('permission alone does not enable fast or add unsupported model capabilities', () => {
        for (const [enabled, tiers] of [[false, ['fast']], [true, []]] as const) {
            assert.equal(resolvePreferredCodexServiceTier({
                enabled,
                connection: customConnection,
                customFastModeEnabled: true,
                models: [createModel([...tiers])],
                modelId: 'gpt-5.6-sol',
            }), 'standard')
        }
    })

    test('official connections require ChatGPT login even when third-party fast is allowed', () => {
        for (const connection of [null, { ...officialConnection, authStatus: 'unauthenticated' }, { ...officialConnection, authType: 'apiKey' }]) {
            assert.equal(resolvePreferredCodexServiceTier({
                enabled: true,
                connection,
                customFastModeEnabled: true,
                models: [createModel(['fast'])],
                modelId: 'gpt-5.6-sol',
            }), 'standard')
        }
    })
})
