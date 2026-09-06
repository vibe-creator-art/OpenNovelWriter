const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { createJiti } = require('jiti')

const jiti = createJiti(__filename, { alias: { '@': path.resolve(__dirname, '../../') } })

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

test('Codex refresh and stream recovery', async (t) => {
    const { useEditorCodexStore: store } = await jiti.import('./editor-codex-store.ts')
    const { codexSessionApi: api } = await jiti.import('../../lib/api.ts')
    const originalList = api.list
    const originalStream = api.streamMessage
    const originalState = store.getState()
    t.after(() => {
        api.list = originalList
        api.streamMessage = originalStream
        store.setState(originalState, true)
    })

    const session = {
        id: 'session-recovery-test', novelId: 'novel-recovery-test', category: 'general',
        status: 'idle', draftContent: '', draftAttachments: [], draftArtifacts: [],
        messages: [], updatedAt: '2026-09-06T00:00:00.000Z', lastError: null,
    }
    const completed = {
        ...session,
        updatedAt: '2026-09-06T00:01:00.000Z',
        messages: [{ id: 'final', role: 'assistant', content: 'Task finished', createdAt: '2026-09-06T00:01:00.000Z' }],
    }
    const seed = () => store.setState({
        sessionsByNovel: {
            [session.novelId]: { sessions: [session], selectedSessionId: session.id, loaded: true, loading: false, error: null },
        },
    })
    const current = () => store.getState().sessionsByNovel[session.novelId].sessions[0]
    let streamOptions
    let stream
    api.streamMessage = (_id, _content, options) => {
        streamOptions = options
        stream = deferred()
        options.signal.addEventListener('abort', () => stream.resolve(), { once: true })
        return stream.promise
    }

    await t.test('a delayed list response cannot erase a completed streamed turn', async () => {
        seed()
        const response = deferred()
        api.list = () => response.promise
        const refresh = store.getState().loadSessions(session.novelId, { force: true })
        const run = store.getState().sendMessage(session.novelId, session.id, 'Run task')
        streamOptions.onEvent({ type: 'done', session: completed })
        stream.resolve()
        await run
        response.resolve({ sessions: [session] })
        await refresh
        assert.deepEqual(current().messages, completed.messages)
        assert.equal(current().status, 'idle')
    })

    await t.test('a refresh recovers the result after a dropped stream', async () => {
        seed()
        const run = store.getState().sendMessage(session.novelId, session.id, 'Run task')
        stream.reject(new Error('Connection dropped'))
        await assert.rejects(run, /Connection dropped/)
        api.list = async () => ({ sessions: [completed] })
        await store.getState().loadSessions(session.novelId, { force: true })
        assert.equal(current().status, 'idle')
        assert.deepEqual(current().messages, completed.messages)
    })

    await t.test('a recovered stalled stream releases the task and ignores late events', async () => {
        seed()
        const run = store.getState().sendMessage(session.novelId, session.id, 'Run task')
        const oldOptions = streamOptions
        api.list = async () => ({ sessions: [completed] })
        await store.getState().loadSessions(session.novelId, { force: true })
        await run
        assert.equal(oldOptions.signal.aborted, true)
        assert.deepEqual(current().messages, completed.messages)

        const nextRun = store.getState().sendMessage(session.novelId, session.id, 'Next task')
        assert.notEqual(streamOptions, oldOptions)
        assert.equal(current().status, 'running')
        const nextMessages = current().messages
        oldOptions.onEvent({ type: 'done', session: completed })
        oldOptions.onEvent({ type: 'assistant_delta', id: 'late', delta: 'old output' })
        assert.equal(current().status, 'running')
        assert.equal(current().messages, nextMessages)
        streamOptions.onEvent({ type: 'done', session: completed })
        stream.resolve()
        await nextRun
    })
})
