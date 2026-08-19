import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
    getContextWindowFromCodexNotification,
    getContextWindowFromThreadTokenUsage,
    getContextWindowFromTokenCount,
    getLatestContextWindowFromMessages,
} from './codex-context-window'

const lastUsage = {
    inputTokens: 12_000,
    cachedInputTokens: 2_000,
    outputTokens: 800,
    reasoningOutputTokens: 200,
    totalTokens: 15_000,
}

describe('getContextWindowFromThreadTokenUsage', () => {
    test('maps official thread/tokenUsage/updated params', () => {
        const window = getContextWindowFromThreadTokenUsage({
            threadId: 'thr_1',
            turnId: 'turn_1',
            tokenUsage: {
                last: lastUsage,
                total: { ...lastUsage, totalTokens: 40_000 },
                modelContextWindow: 272_000,
            },
        })

        assert.deepEqual(window, {
            usedTokens: 15_000,
            totalTokens: 272_000,
            usagePercent: 15_000 / 272_000 * 100,
            remainingTokens: 257_000,
            lastTokenUsage: lastUsage,
            totalTokenUsage: { ...lastUsage, totalTokens: 40_000 },
        })
    })

    test('falls back to the previous model window when the snapshot omits it', () => {
        const window = getContextWindowFromThreadTokenUsage({
            tokenUsage: {
                last: lastUsage,
                total: lastUsage,
                modelContextWindow: null,
            },
        }, {
            usedTokens: 1,
            totalTokens: 128_000,
            usagePercent: 0,
            remainingTokens: 128_000,
            lastTokenUsage: null,
            totalTokenUsage: null,
        })

        assert.equal(window?.totalTokens, 128_000)
        assert.equal(window?.usedTokens, 15_000)
    })

    test('returns null without a usable model window', () => {
        assert.equal(getContextWindowFromThreadTokenUsage({
            tokenUsage: { last: lastUsage, total: lastUsage, modelContextWindow: null },
        }), null)
    })
})

describe('getContextWindowFromTokenCount', () => {
    test('parses a nested legacy token_count payload', () => {
        const window = getContextWindowFromTokenCount({
            payload: {
                type: 'token_count',
                info: {
                    model_context_window: 272_000,
                    last_token_usage: {
                        input_tokens: 12_000,
                        cached_input_tokens: 2_000,
                        output_tokens: 800,
                        reasoning_output_tokens: 200,
                        total_tokens: 15_000,
                    },
                    total_token_usage: {
                        input_tokens: 30_000,
                        cached_input_tokens: 4_000,
                        output_tokens: 1_600,
                        reasoning_output_tokens: 400,
                        total_tokens: 36_000,
                    },
                },
            },
        })

        assert.equal(window?.usedTokens, 15_000)
        assert.equal(window?.totalTokens, 272_000)
        assert.equal(window?.totalTokenUsage?.totalTokens, 36_000)
    })
})

describe('getContextWindowFromCodexNotification', () => {
    test('prefers the official method over a coincidental token_count nest', () => {
        const window = getContextWindowFromCodexNotification('thread/tokenUsage/updated', {
            tokenUsage: {
                last: lastUsage,
                total: lastUsage,
                modelContextWindow: 100_000,
            },
        })
        assert.equal(window?.totalTokens, 100_000)
    })

    test('still accepts legacy token_count on unrelated methods', () => {
        const window = getContextWindowFromCodexNotification('item/completed', {
            payload: {
                type: 'token_count',
                info: {
                    model_context_window: 50_000,
                    last_token_usage: {
                        input_tokens: 1,
                        cached_input_tokens: 0,
                        output_tokens: 0,
                        reasoning_output_tokens: 0,
                        total_tokens: 1,
                    },
                },
            },
        })
        assert.equal(window?.totalTokens, 50_000)
    })
})

describe('getLatestContextWindowFromMessages', () => {
    test('returns the newest non-null context window', () => {
        assert.equal(getLatestContextWindowFromMessages([
            { contextWindow: { usedTokens: 1, totalTokens: 10, usagePercent: 10, remainingTokens: 9, lastTokenUsage: null, totalTokenUsage: null } },
            {},
            { contextWindow: { usedTokens: 4, totalTokens: 10, usagePercent: 40, remainingTokens: 6, lastTokenUsage: null, totalTokenUsage: null } },
        ])?.usedTokens, 4)
    })
})
