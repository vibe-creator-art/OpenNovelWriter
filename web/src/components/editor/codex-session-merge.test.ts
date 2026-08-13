import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { CodexSession } from '@/lib/api'

const { mergeServerSession } = await import(new URL('./codex-session-merge.ts', import.meta.url).href)

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
        ...overrides,
    }
}

describe('mergeServerSession', () => {
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
