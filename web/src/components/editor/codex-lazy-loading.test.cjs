const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { createJiti } = require('jiti')
const jiti = createJiti(__filename, { alias: { '@': path.resolve(__dirname, '../..') } })

function deferred() {
    let resolve, reject
    const promise = new Promise((a, b) => { resolve = a; reject = b })
    return { promise, resolve, reject }
}

const session = {
    id: 'lazy-session', novelId: 'lazy-novel', category: 'general', status: 'idle',
    draftContent: '', draftAttachments: [], draftArtifacts: [], historyLoaded: true,
    messageCount: 1, previewTitle: 'Saved conversation', previewText: 'Saved reply',
    messages: [{ id: 'reply', role: 'assistant', content: 'Saved reply' }],
    updatedAt: '2026-09-11T00:00:00.000Z', lastError: null,
}
function summary(value) {
    const { messages, historyLoaded, ...metadata } = value
    return metadata
}

test('session summaries and histories load independently', async (t) => {
    const { useEditorCodexStore: store } = await jiti.import('./editor-codex-store.ts')
    const { codexSessionApi: api } = await jiti.import('../../lib/api.ts')
    const originalState = store.getState()
    const original = { list: api.list, get: api.get, create: api.create, update: api.update }
    t.after(async () => {
        await new Promise((resolve) => setTimeout(resolve, 550))
        Object.assign(api, original)
        store.setState(originalState, true)
    })
    const second = { ...session, id: 'lazy-other' }
    store.setState({ sessionsByNovel: {}, historyRequestsBySession: {} })
    api.list = async () => ({ sessions: [summary(session), summary(second)] })
    api.update = async () => ({ session })
    const history = deferred()
    let requests = 0
    api.get = () => { requests++; return history.promise }
    await store.getState().loadSessions(session.novelId)
    const current = () => store.getState().sessionsByNovel[session.novelId].sessions.find((item) => item.id === session.id)
    assert.equal(requests, 0)
    assert.equal(current().historyLoaded, false)
    assert.equal(current().messageCount, 1)
    assert.deepEqual(current().messages, [])

    const first = store.getState().loadSession(session.novelId, session.id)
    const duplicate = store.getState().loadSession(session.novelId, session.id)
    assert.equal(requests, 1)
    store.getState().selectSession(session.novelId, second.id)
    store.getState().updateDraft(session.novelId, session.id, 'Keep this draft')
    history.resolve({ session })
    await Promise.all([first, duplicate])
    assert.equal(current().historyLoaded, true)
    assert.equal(current().draftContent, 'Keep this draft')
    assert.equal(current().messages[0].content, 'Saved reply')
    assert.equal(store.getState().sessionsByNovel[session.novelId].selectedSessionId, second.id)
    await store.getState().loadSession(session.novelId, session.id)
    assert.equal(requests, 1)

    const newer = { ...session, updatedAt: '2026-09-11T00:01:00.000Z', messageCount: 2, previewText: 'New reply' }
    api.list = async () => ({ sessions: [summary(newer), summary(second)] })
    await store.getState().loadSessions(session.novelId, { force: true })
    assert.equal(requests, 1)
    assert.equal(current().historyLoaded, false)
    assert.equal(current().previewText, 'New reply')

    let creates = 0
    api.create = async () => {
        creates++
        return { session: { ...session, id: 'new-draft', messageCount: 0, messages: [] }, codexSessionCleanup: { deletedSessionIds: [] } }
    }
    assert.equal(await store.getState().createSession(session.novelId), 'new-draft')
    assert.equal(creates, 1, 'An unloaded existing conversation must not be reused as an empty draft')
})

test('history loading can retry and cannot resurrect a deleted session', async (t) => {
    const { useEditorCodexStore: store } = await jiti.import('./editor-codex-store.ts')
    const { codexSessionApi: api } = await jiti.import('../../lib/api.ts')
    const original = api.get
    const originalState = store.getState()
    const value = { ...session, id: 'lazy-retry', historyLoaded: false, messages: [] }
    t.after(() => { api.get = original; store.setState(originalState, true) })
    store.setState({ sessionsByNovel: { [value.novelId]: { sessions: [value], selectedSessionId: value.id, loaded: true, loading: false, error: null } } })
    api.get = async () => { throw new Error('Offline') }
    await store.getState().loadSession(value.novelId, value.id)
    assert.equal(store.getState().historyRequestsBySession[value.id].error, 'Offline')
    api.get = async () => ({ session: { ...value, historyLoaded: true, messages: session.messages } })
    await store.getState().loadSession(value.novelId, value.id)
    assert.equal(store.getState().historyRequestsBySession[value.id].error, null)
    const request = deferred()
    api.get = () => request.promise
    const pending = store.getState().loadSession(value.novelId, value.id, { force: true })
    store.getState().removeDeletedSession(value.novelId, value.id)
    request.resolve({ session: value })
    await pending
    assert.deepEqual(store.getState().sessionsByNovel[value.novelId].sessions, [])
    assert.equal(store.getState().historyRequestsBySession[value.id], undefined)
})

test('tool details cache by session and version, ignore superseded responses, and retry failures', async (t) => {
    const { useCodexWorkDetailsStore: store } = await jiti.import('./codex-work-details-store.ts')
    const { codexSessionApi: api } = await jiti.import('../../lib/api.ts')
    const original = api.getMessage
    const originalState = store.getState()
    t.after(() => { api.getMessage = original; store.setState(originalState, true) })
    store.setState({ details: {} })
    let count = 0
    const old = deferred()
    api.getMessage = () => { count++; return old.promise }
    const pending = store.getState().load('session-a', 'tool', 'v1')
    await store.getState().load('session-a', 'tool', 'v1')
    assert.equal(count, 1)
    api.getMessage = async () => { count++; return { version: 'v2', message: { content: 'New output' } } }
    await store.getState().load('session-a', 'tool', 'v2')
    old.resolve({ version: 'v1', message: { content: 'Old output' } })
    await pending
    assert.equal(store.getState().details['session-a'].tool.message.content, 'New output')
    await store.getState().load('session-a', 'tool', 'v2')
    assert.equal(count, 2)
    await store.getState().load('session-b', 'tool', 'v2')
    assert.equal(count, 3)
    api.getMessage = async () => { throw new Error('Offline') }
    await store.getState().load('session-a', 'tool', 'v3')
    assert.equal(store.getState().details['session-a'].tool.error, 'Offline')
    api.getMessage = async () => ({ version: 'v3', message: { content: 'Retried output' } })
    await store.getState().load('session-a', 'tool', 'v3')
    assert.equal(store.getState().details['session-a'].tool.message.content, 'Retried output')
    const removed = deferred()
    api.getMessage = () => removed.promise
    const late = store.getState().load('session-a', 'tool', 'v4')
    store.getState().clear('session-a')
    removed.resolve({ version: 'v4', message: { content: 'Deleted output' } })
    await late
    assert.equal(store.getState().details['session-a'], undefined)
})
