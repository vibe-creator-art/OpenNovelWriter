import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { mergeCodexRateLimits, parseCodexRateLimitSnapshot } from './codex-rate-limits'

describe('parseCodexRateLimitSnapshot', () => {
    test('parses an account/rateLimits/updated envelope', () => {
        const snapshot = parseCodexRateLimitSnapshot({
            rateLimits: {
                limitId: 'plus',
                limitName: 'Plus',
                planType: 'plus',
                primary: { usedPercent: 42.5, windowDurationMins: 300, resetsAt: 1_700_000_000 },
                secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: null },
                credits: { hasCredits: true, unlimited: false, balance: '12.5' },
            },
        })

        assert.deepEqual(snapshot, {
            credits: { hasCredits: true, unlimited: false, balance: '12.5' },
            limitName: 'Plus',
            limitId: 'plus',
            planType: 'plus',
            primary: { usedPercent: 42.5, resetsAt: 1_700_000_000, windowDurationMins: 300 },
            secondary: { usedPercent: 10, resetsAt: null, windowDurationMins: 10_080 },
        })
    })

    test('returns null for an empty object', () => {
        assert.equal(parseCodexRateLimitSnapshot({}), null)
    })
})

describe('mergeCodexRateLimits', () => {
    const previous = {
        credits: { hasCredits: true, unlimited: false, balance: '12.5' },
        limitName: 'Plus',
        limitId: 'plus',
        planType: 'plus',
        primary: { usedPercent: 10, resetsAt: 100, windowDurationMins: 300 },
        secondary: { usedPercent: 5, resetsAt: 200, windowDurationMins: 10_080 },
    }

    test('keeps previous windows when a rolling update omits them', () => {
        const merged = mergeCodexRateLimits(previous, {
            credits: null,
            limitName: null,
            limitId: null,
            planType: null,
            primary: { usedPercent: 55 },
            secondary: null,
        })

        assert.deepEqual(merged, {
            credits: { hasCredits: true, unlimited: false, balance: '12.5' },
            limitName: 'Plus',
            limitId: 'plus',
            planType: 'plus',
            primary: { usedPercent: 55, resetsAt: 100, windowDurationMins: 300 },
            secondary: { usedPercent: 5, resetsAt: 200, windowDurationMins: 10_080 },
        })
    })

    test('uses the incoming snapshot when there is no previous value', () => {
        const incoming = parseCodexRateLimitSnapshot({
            primary: { usedPercent: 3, windowDurationMins: 300 },
        })
        assert.deepEqual(mergeCodexRateLimits(null, incoming), incoming)
    })
})
