import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const {
    completionReadAtOnDraftChange,
    completionReadAtOnInteraction,
} = await import(new URL('./codex-completion-read.ts', import.meta.url).href)

const COMPLETED_AT = '2026-08-09T08:00:00.000Z'

function createState(selectedSessionId: string | null = 'session-1') {
    return {
        selectedSessionId,
        sessions: [
            { id: 'session-1', unreadCompletionAt: COMPLETED_AT },
            { id: 'session-2', unreadCompletionAt: COMPLETED_AT },
        ],
    }
}

describe('Codex completion read policy', () => {
    test('interacting with an unread session clears its completion, including the current session', () => {
        const state = createState()

        assert.equal(completionReadAtOnInteraction(state, 'session-1'), COMPLETED_AT)
        assert.equal(completionReadAtOnInteraction(state, 'session-2'), COMPLETED_AT)
    })

    test('meaningful draft input clears a completion only for the selected session', () => {
        const state = createState()

        assert.equal(completionReadAtOnDraftChange(state, 'session-1', 'Continue'), COMPLETED_AT)
        assert.equal(completionReadAtOnDraftChange(state, 'session-1', '   '), null)
        assert.equal(completionReadAtOnDraftChange(state, 'session-2', 'Continue'), null)
    })

    test('an already-read session stays read while typing', () => {
        const state = {
            selectedSessionId: 'session-1',
            sessions: [{ id: 'session-1', unreadCompletionAt: null }],
        }

        assert.equal(completionReadAtOnDraftChange(state, 'session-1', 'Continue'), null)
    })
})
