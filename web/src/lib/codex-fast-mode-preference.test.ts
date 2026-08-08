import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { CodexConnectionSummary, CodexModelCatalogEntry } from '@/lib/api'
import { resolvePreferredCodexServiceTier } from '@/lib/codex-fast-mode-preference'

function createConnection(overrides: Partial<CodexConnectionSummary> = {}): CodexConnectionSummary {
    return {
        id: 'connection-1',
        name: 'Official',
        providerType: 'openai-official',
        upstreamFormat: null,
        baseUrl: null,
        hasApiKey: false,
        defaultModelId: 'gpt-5.6-sol',
        models: [],
        isActive: true,
        note: null,
        authStatus: 'authenticated',
        authType: 'chatgpt',
        accountEmail: null,
        accountPlan: null,
        lastAuthError: null,
        createdAt: '2026-08-08T00:00:00.000Z',
        updatedAt: '2026-08-08T00:00:00.000Z',
        ...overrides,
    }
}

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
    test('enables fast for an authenticated official connection and supported model', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: true,
            connection: createConnection(),
            models: [createModel(['fast'])],
            modelId: 'gpt-5.6-sol',
        }), 'fast')
    })

    test('keeps standard when the user preference is off', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: false,
            connection: createConnection(),
            models: [createModel(['fast'])],
            modelId: 'gpt-5.6-sol',
        }), 'standard')
    })

    test('keeps standard for ineligible connections without changing the preference', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: true,
            connection: createConnection({ providerType: 'custom', authType: 'api_key' }),
            models: [createModel(['fast'])],
            modelId: 'gpt-5.6-sol',
        }), 'standard')
    })

    test('keeps standard when the default model has no fast tier', () => {
        assert.equal(resolvePreferredCodexServiceTier({
            enabled: true,
            connection: createConnection(),
            models: [createModel([])],
            modelId: 'gpt-5.6-sol',
        }), 'standard')
    })
})
