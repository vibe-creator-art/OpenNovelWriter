import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { CodexSession, CodexSessionSummary } from '@/lib/api'

const { mergeRefreshedSession, mergeServerSession, mergeSessionSummary } = await import(new URL('./codex-session-merge.ts', import.meta.url).href)

function createSession(overrides: Partial<CodexSession> = {}): CodexSession {
    return {
        id: 'session-1',
        category: 'general',
        title: null,
        titleManuallyEdited: false,
        reviewLevel: 'user_review',
        modelId: 'gpt-5.6-luna',
        reasoningEffort: 'high',
        serviceTier: 'standard',
        composerMode: 'default',
        goal: null,
        codexThreadId: null,
        codexConnectionId: null,
        draftContent: '',
        draftAttachments: [],
        draftArtifacts: [],
        status: 'idle',
        lastError: null,
        unreadCompletionAt: null,
        novelId: 'novel-1',
        ownerId: 'owner-1',
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:00.000Z',
        messages: [],
        historyLoaded: true,
        messageCount: 0,
        previewTitle: '',
        previewText: '',
        ...overrides,
    }
}

describe('mergeServerSession', () => {
    test('ignores a delayed response older than a completed turn', () => {
        const local = createSession({
            updatedAt: '2026-08-05T00:00:03.000Z',
            messages: [{ id: 'final', role: 'assistant', content: 'complete', createdAt: '2026-08-05T00:00:02.000Z' }],
        })
        assert.equal(mergeServerSession(local, createSession({ status: 'running' })), local)
    })
    test('keeps an in-flight local run during an ordinary refresh', () => {
        const local = createSession({ status: 'running', messages: [{ id: 'stream', role: 'assistant', content: 'partial', createdAt: '2026-08-05T00:00:01.000Z' }] })
        const server = createSession({ status: 'idle', messages: [] })

        const merged = mergeServerSession(local, server)

        assert.equal(merged.status, 'running')
        assert.equal(merged.messages[0]?.content, 'partial')
    })

    test('accepts the server terminal state after completion or stop', () => {
        const local = createSession({
            status: 'running',
            draftContent: 'unsaved draft',
            messages: [{ id: 'stream', role: 'assistant', content: 'partial', createdAt: '2026-08-05T00:00:01.000Z' }],
        })
        const server = createSession({
            status: 'idle',
            unreadCompletionAt: '2026-08-05T00:00:02.000Z',
            messages: [{ id: 'final', role: 'assistant', content: 'complete', createdAt: '2026-08-05T00:00:02.000Z' }],
        })

        const merged = mergeServerSession(local, server, { preserveRunning: false })

        assert.equal(merged.status, 'idle')
        assert.equal(merged.unreadCompletionAt, '2026-08-05T00:00:02.000Z')
        assert.equal(merged.messages[0]?.content, 'complete')
        assert.equal(merged.draftContent, 'unsaved draft')
    })

    test('accepts the authoritative paused goal state and persisted turn messages', () => {
        const local = createSession({
            status: 'running',
            messages: [{ id: 'stream', role: 'assistant', content: 'stale', createdAt: '2026-08-05T00:00:01.000Z' }],
        })
        const server = createSession({
            status: 'idle',
            goal: {
                threadId: 'thread-1',
                objective: 'Keep counting',
                status: 'paused',
                tokenBudget: null,
                tokensUsed: 100,
                timeUsedSeconds: 60,
                createdAt: 1_786_000_000,
                updatedAt: 1_786_000_060,
            },
            messages: [{ id: 'persisted', role: 'assistant', content: '2', createdAt: '2026-08-05T00:00:02.000Z' }],
        })

        const merged = mergeServerSession(local, server, { preserveRunning: false })

        assert.equal(merged.status, 'idle')
        assert.equal(merged.goal?.status, 'paused')
        assert.equal(merged.messages[0]?.content, '2')
    })
})

describe('mergeRefreshedSession', () => {
    const running = createSession({
        status: 'running',
        messages: [{ id: 'stream', role: 'assistant', content: 'progress', createdAt: '2026-08-05T00:00:01.000Z' }],
        draftContent: 'next message',
    })
    const completed = createSession({
        updatedAt: '2026-08-05T00:00:03.000Z',
        messages: [{ id: 'stream', role: 'assistant', content: 'progress complete', createdAt: '2026-08-05T00:00:01.000Z' }],
    })

    test('does not overwrite stream completion delivered during the request', () => {
        assert.equal(mergeRefreshedSession(completed, running, running, false), completed)
    })

    test('does not overwrite a new turn started during the request', () => {
        assert.equal(mergeRefreshedSession(running, completed, completed, true), running)
    })

    test('does not roll back progress delivered during the request', () => {
        const latest = { ...running, messages: completed.messages }
        assert.equal(mergeRefreshedSession(latest, running, running, true), latest)
    })

    test('recovers completion when the stream has disconnected or stalled', () => {
        for (const hasActiveStream of [false, true]) {
            const merged = mergeRefreshedSession(running, completed, running, hasActiveStream)
            assert.equal(merged.status, 'idle')
            assert.deepEqual(merged.messages, completed.messages)
            assert.equal(merged.draftContent, 'next message')
        }
    })

    test('keeps progress when only an earlier checkpoint has been saved', () => {
        const checkpoint = createSession({ status: 'running', updatedAt: completed.updatedAt })
        const merged = mergeRefreshedSession(running, checkpoint, running, false)
        assert.deepEqual(merged.messages, running.messages)
        assert.equal(merged.status, 'running')
    })

    test('loads a newer saved turn when there is no live stream', () => {
        const checkpoint = { ...completed, status: 'running' as const }
        const merged = mergeRefreshedSession(running, checkpoint, running, false)
        assert.deepEqual(merged.messages, completed.messages)
    })

    test('keeps an optimistic run when the server has not started it yet', () => {
        const merged = mergeRefreshedSession(running, createSession(), running, true)
        assert.equal(merged.status, 'running')
        assert.deepEqual(merged.messages, running.messages)
    })
})

test('a running summary can load its initial history at the same saved timestamp', () => {
    const summary = createSession({ status: 'running', historyLoaded: false })
    const detail = createSession({ status: 'running', messages: [{ id: 'live', role: 'assistant', content: 'Working', createdAt: summary.updatedAt }] })
    const merged = mergeRefreshedSession(summary, detail, summary, false)
    assert.equal(merged.historyLoaded, true)
    assert.deepEqual(merged.messages, detail.messages)
})

test('summary refresh retains active streamed messages and invalidates only changed inactive histories', () => {
    const local = createSession({ status: 'running', messages: [{ id: 'live', role: 'assistant', content: 'Working', createdAt: '2026-08-05T00:00:01.000Z' }] })
    const summary: CodexSessionSummary & Partial<Pick<CodexSession, 'messages' | 'historyLoaded'>> = createSession({ status: 'running', updatedAt: '2026-08-05T00:00:02.000Z' })
    delete summary.messages
    delete summary.historyLoaded
    const active = mergeSessionSummary(local, summary, local, true)
    assert.equal(active.messages, local.messages)
    assert.equal(active.historyLoaded, true)
    const changed = mergeSessionSummary(local, { ...summary, status: 'idle' }, local, true)
    assert.equal(changed.historyLoaded, false)
    assert.equal(changed.status, 'idle')
    assert.equal(changed.messages, local.messages)
    const inFlight = { ...local, messages: [...local.messages] }
    assert.equal(mergeSessionSummary(inFlight, summary, local, true), inFlight)
})
