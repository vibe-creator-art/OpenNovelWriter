import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
    normalizeCodexComposerMode,
    parseCodexSessionMessages,
    parseCodexThreadGoal,
} from './codex-session'

describe('Codex composer mode', () => {
    test('accepts only the three supported modes', () => {
        assert.equal(normalizeCodexComposerMode('default'), 'default')
        assert.equal(normalizeCodexComposerMode('plan'), 'plan')
        assert.equal(normalizeCodexComposerMode('goal'), 'goal')
        assert.equal(normalizeCodexComposerMode('legacy'), null)
    })
})

describe('Codex thread goal', () => {
    const goal = {
        threadId: 'thread-1',
        objective: 'Finish the draft',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 120,
        timeUsedSeconds: 8,
        createdAt: 1_786_569_600,
        updatedAt: 1_786_569_608,
    }

    test('parses an app-server goal', () => {
        assert.deepEqual(parseCodexThreadGoal(JSON.stringify(goal)), goal)
    })

    test('rejects an invalid goal status', () => {
        assert.equal(parseCodexThreadGoal(JSON.stringify({ ...goal, status: 'idle' })), null)
    })
})

describe('Codex goal messages', () => {
    test('preserves the sent-as-goal marker', () => {
        const messages = parseCodexSessionMessages(JSON.stringify([{
            id: 'message-1',
            role: 'user',
            content: 'Finish the draft',
            sentAsGoal: true,
            createdAt: '2026-08-13T00:00:00.000Z',
        }]))

        assert.equal(messages[0]?.sentAsGoal, true)
    })
})
