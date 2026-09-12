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

function summary(session) {
    const { messages, historyLoaded, ...metadata } = session
    return { ...metadata, messageCount: messages.length }
}

test('question recovery preserves drafts and does not resurrect resolved requests', async (t) => {
    const { useEditorCodexStore: store } = await jiti.import('./editor-codex-store.ts')
    const { codexSessionApi: api } = await jiti.import('../../lib/api.ts')
    const originalState = store.getState()
    const original = { streamMessage: api.streamMessage, update: api.update, listUserInputRequests: api.listUserInputRequests, answerUserInput: api.answerUserInput }
    t.after(() => { Object.assign(api, original); store.setState(originalState, true) })
    const session = {
        historyLoaded: true, messageCount: 0, previewTitle: '', previewText: '',
        id: 'question-session', novelId: 'question-novel', category: 'general', status: 'idle',
        draftContent: 'My draft', draftAttachments: ['/reference.png'], draftArtifacts: [], messages: [],
        updatedAt: '2026-09-10T00:00:00Z', lastError: null,
    }
    store.setState({ sessionsByNovel: {
        [session.novelId]: { sessions: [session], selectedSessionId: session.id, loaded: true, loading: false, error: null },
    } })
    api.update = async () => ({ session })
    const streaming = deferred()
    let streamOptions
    api.streamMessage = (_id, _text, options) => { streamOptions = options; return streaming.promise }
    const run = store.getState().sendMessage(session.novelId, session.id, 'Review the chapter', { preserveComposer: true })
    const first = { id: 'first', sessionId: session.id, delivery: 'async-message', questions: [] }
    const second = { ...first, id: 'second' }
    const requests = () => store.getState().userInputRequestsBySession[session.id]
    const refreshResponse = deferred()
    api.listUserInputRequests = () => refreshResponse.promise
    const refresh = store.getState().refreshUserInputRequests(session.id)
    streamOptions.onEvent({ type: 'user_input_request', request: first })
    streamOptions.onEvent({ type: 'user_input_request', request: first })
    assert.equal(requests().length, 1)
    streamOptions.onEvent({ type: 'user_input_resolved', id: first.id })
    refreshResponse.resolve({ requests: [first] })
    await refresh
    assert.deepEqual(requests(), [])
    api.listUserInputRequests = async () => ({ requests: [first, second] })
    await store.getState().refreshUserInputRequests(session.id)
    let submitted
    api.answerUserInput = async (...args) => { submitted = args }
    const response = { answers: { tone: { answers: ['Reflective'] } } }
    await store.getState().answerUserInput(session.id, first.id, response)
    assert.deepEqual(submitted, [session.id, first.id, response])
    assert.deepEqual(requests(), [second])
    const current = store.getState().sessionsByNovel[session.novelId].sessions[0]
    assert.equal(current.draftContent, session.draftContent)
    assert.deepEqual(current.draftAttachments, session.draftAttachments)
    streamOptions.onEvent({ type: 'done', session })
    assert.deepEqual(requests(), [])
    streaming.resolve()
    await run
    await new Promise((resolve) => setTimeout(resolve, 550))
})

test('Codex refresh and stream recovery', async (t) => {
    const { useEditorCodexStore: store } = await jiti.import('./editor-codex-store.ts')
    const { codexSessionApi: api, ApiError } = await jiti.import('../../lib/api.ts')
    const originalGet = api.get
    const originalList = api.list
    const originalStream = api.streamMessage
    const originalUpdate = api.update
    api.update = async () => ({ session })
    const originalState = store.getState()
    t.after(() => {
        api.get = originalGet
        api.list = originalList
        api.streamMessage = originalStream
        api.update = originalUpdate
        store.setState(originalState, true)
    })

    const session = {
        historyLoaded: true, messageCount: 0, previewTitle: '', previewText: '',
        id: 'session-recovery-test', novelId: 'novel-recovery-test', category: 'general',
        status: 'idle', draftContent: '', draftAttachments: [], draftArtifacts: [],
        messages: [], updatedAt: '2026-09-06T00:00:00.000Z', lastError: null,
    }
    const completed = {
        ...session,
        updatedAt: '2026-09-06T00:01:00.000Z',
        messages: [{ id: 'final', role: 'assistant', content: 'Task finished', createdAt: '2026-09-06T00:01:00.000Z' }],
    }
    api.get = async () => ({ session })
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

    await t.test('tool start and completion update one row and preserve its arguments', async () => {
        seed()
        const run = store.getState().sendMessage(session.novelId, session.id, 'Check story state')
        const event = { id: 'tool-1', kind: 'tool', title: 'query_story_state', content: '', workStatus: 'running', toolInput: '{"name":"Mira"}', createdAt: session.updatedAt }
        streamOptions.onEvent({ type: 'event', event })
        assert.equal(current().messages.find((message) => message.id === event.id).workStatus, 'running')
        streamOptions.onEvent({ type: 'event', event: { ...event, workStatus: 'completed', content: '{"ok":true}' } })
        const calls = current().messages.filter((message) => message.id === event.id)
        assert.equal(calls.length, 1)
        assert.equal(calls[0].workStatus, 'completed')
        assert.equal(calls[0].toolInput, event.toolInput)
        assert.equal(calls[0].content, 'query_story_state\n\n{"ok":true}')
        streamOptions.onEvent({ type: 'done', session: completed })
        stream.resolve()
        await run
    })

    await t.test('reasoning deltas stay separate and final text survives reload', async () => {
        seed()
        const run = store.getState().sendMessage(session.novelId, session.id, 'Think through the scene')
        const thought = { id: 'thought', delta: 'First', createdAt: session.updatedAt }
        streamOptions.onEvent({ type: 'reasoning_delta', ...thought })
        streamOptions.onEvent({ type: 'assistant_delta', id: 'reply', delta: 'Answer', createdAt: session.updatedAt })
        streamOptions.onEvent({ type: 'reasoning_delta', ...thought, delta: ' thought' })
        assert.equal(current().messages.find((message) => message.id === 'thought').content, 'First thought')
        streamOptions.onEvent({ type: 'event', event: { id: thought.id, kind: 'reasoning', title: '', content: 'Final thought', workStatus: 'completed', createdAt: thought.createdAt } })
        assert.equal(current().messages.filter((message) => message.role === 'assistant').map((message) => message.content).join(''), 'Answer')
        assert.equal(current().messages.filter((message) => message.id === thought.id).length, 1)
        const saved = { ...current(), status: 'idle' }
        streamOptions.onEvent({ type: 'done', session: saved })
        stream.resolve()
        await run
        api.list = async () => ({ sessions: [summary(saved)] })
        await store.getState().loadSessions(session.novelId, { force: true })
        assert.equal(current().messages.find((message) => message.id === 'thought').content, 'Final thought')
    })

    await t.test('a delayed list response cannot erase a completed streamed turn', async () => {
        seed()
        const response = deferred()
        api.list = () => response.promise
        const refresh = store.getState().loadSessions(session.novelId, { force: true })
        const run = store.getState().sendMessage(session.novelId, session.id, 'Run task')
        streamOptions.onEvent({ type: 'done', session: completed })
        stream.resolve()
        await run
        response.resolve({ sessions: [summary(session)] })
        await refresh
        assert.deepEqual(current().messages, completed.messages)
        assert.equal(current().status, 'idle')
    })

    await t.test('a refresh recovers the result after a dropped stream', async () => {
        seed()
        const run = store.getState().sendMessage(session.novelId, session.id, 'Run task')
        stream.reject(new Error('Connection dropped'))
        await assert.rejects(run, /Connection dropped/)
        api.list = async () => ({ sessions: [summary(completed)] })
        api.get = async () => ({ session: completed })
        await store.getState().loadSessions(session.novelId, { force: true })
        await store.getState().loadSession(session.novelId, session.id)
        assert.equal(current().status, 'idle')
        assert.deepEqual(current().messages, completed.messages)
    })

    await t.test('a recovered stalled stream releases the task and ignores late events', async () => {
        seed()
        const run = store.getState().sendMessage(session.novelId, session.id, 'Run task')
        const oldOptions = streamOptions
        api.list = async () => ({ sessions: [summary(completed)] })
        api.get = async () => ({ session: completed })
        await store.getState().loadSessions(session.novelId, { force: true })
        await store.getState().loadSession(session.novelId, session.id)
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

    for (const status of [400, 404, 409]) {
        await t.test(`HTTP ${status} restores the rejected draft and its attachments`, async () => {
            const draft = { ...session, draftContent: 'Unsent draft', draftAttachments: ['/image.png'], draftArtifacts: [{ fileName: 'draft.json' }] }
            seed()
            store.setState({
                sessionsByNovel: { [session.novelId]: { ...store.getState().sessionsByNovel[session.novelId], sessions: [draft] } },
                imageAttachmentsBySession: { [session.id]: [{ id: 'image', url: '/image.png', status: 'ready' }] },
            })
            const images = store.getState().imageAttachmentsBySession[session.id]
            api.get = async () => ({ session: draft })
            api.streamMessage = async () => { throw new ApiError(status, 'Rejected') }
            await assert.rejects(store.getState().sendMessage(session.novelId, session.id, draft.draftContent), /Rejected/)
            assert.equal(current().status, 'idle')
            assert.deepEqual(current().messages, [])
            assert.equal(current().draftContent, draft.draftContent)
            assert.deepEqual(current().draftAttachments, draft.draftAttachments)
            assert.deepEqual(current().draftArtifacts, draft.draftArtifacts)
            assert.equal(store.getState().imageAttachmentsBySession[session.id], images)
        })
    }

    await t.test('rejection preserves composer edits made while sending, even when cleared again', async () => {
        seed()
        store.getState().updateDraft(session.novelId, session.id, 'Original draft')
        api.get = async () => ({ session })
        const request = deferred()
        api.streamMessage = () => request.promise
        const run = store.getState().sendMessage(session.novelId, session.id, 'Rejected draft')
        store.getState().updateDraft(session.novelId, session.id, 'New draft')
        store.getState().updateDraft(session.novelId, session.id, '')
        request.reject(new ApiError(400, 'Rejected'))
        await assert.rejects(run, /Rejected/)
        assert.equal(current().draftContent, '')
        assert.deepEqual(current().messages, [])
    })

    await t.test('a lost response to an accepted message does not restore it as a draft', async () => {
        seed()
        api.streamMessage = async (_id, content, options) => {
            api.get = async () => ({ session: {
                ...session, status: 'running',
                messages: [{ id: options.messageId, role: 'user', content }],
            } })
            throw new Error('Connection dropped')
        }
        await assert.rejects(store.getState().sendMessage(session.novelId, session.id, 'Accepted task'), /Connection dropped/)
        assert.equal(current().status, 'running')
        assert.equal(current().messages.length, 1)
        assert.equal(current().messages[0].content, 'Accepted task')
        assert.equal(current().draftContent, '')
    })

    await t.test('offline failure restores inputs without resubmitting', async () => {
        seed()
        store.getState().updateDraft(session.novelId, session.id, 'Offline draft')
        api.get = async () => { throw new Error('Offline') }
        let sends = 0
        api.streamMessage = async () => { sends++; throw new Error('Offline') }
        await assert.rejects(store.getState().sendMessage(session.novelId, session.id, 'Offline draft'), /Offline/)
        assert.equal(current().draftContent, 'Offline draft')
        assert.equal(current().status, 'error')
        assert.deepEqual(current().messages, [])
        assert.equal(sends, 1)
    })

    await t.test('a deleted session is not recreated during rejected-send recovery', async () => {
        seed()
        api.get = async () => { throw new ApiError(404, 'Not found') }
        api.streamMessage = async () => { throw new ApiError(404, 'Not found') }
        await assert.rejects(store.getState().sendMessage(session.novelId, session.id, 'Draft'), /Not found/)
        assert.deepEqual(store.getState().sessionsByNovel[session.novelId].sessions, [])
    })
    await new Promise((resolve) => setTimeout(resolve, 550))
})

test('image actions preserve the composer while sending only their selected image', async (t) => {
    const { useEditorCodexStore: store } = await jiti.import('./editor-codex-store.ts')
    const { codexSessionApi: api } = await jiti.import('../../lib/api.ts')
    const originalState = store.getState()
    const originalStream = api.streamMessage
    const originalUpdate = api.update
    const session = {
        historyLoaded: true, messageCount: 0, previewTitle: '', previewText: '',
        id: 'image-action-session', novelId: 'image-action-novel', category: 'general', status: 'idle',
        draftContent: 'My unfinished draft', draftAttachments: ['/uploads/reference.png', '/uploads/selected.png'],
        draftArtifacts: [{ fileName: 'notes.json', originalName: 'notes.json' }], messages: [],
        updatedAt: '2026-09-09T00:00:00Z', lastError: null,
    }
    const images = session.draftAttachments.map((url, i) => ({ id: `image-${i}`, url, previewUrl: url, status: 'ready' }))
    const saves = []
    api.update = async (_id, patch) => { saves.push(patch); return { session } }
    const request = deferred()
    let sent
    api.streamMessage = async (_id, content, options) => {
        sent = { content, attachments: options.attachments }
        await request.promise
    }
    t.after(() => {
        api.streamMessage = originalStream
        api.update = originalUpdate
        store.setState(originalState, true)
    })
    store.setState({ sessionsByNovel: {
        [session.novelId]: { sessions: [session], selectedSessionId: session.id, loaded: true, loading: false, error: null },
    }, imageAttachmentsBySession: { [session.id]: images } })
    const current = () => store.getState().sessionsByNovel[session.novelId].sessions[0]
    const run = store.getState().sendMessage(session.novelId, session.id, 'Remove background', {
        attachments: ['/uploads/selected.png'], preserveComposer: true,
    })
    assert.deepEqual(sent, { content: 'Remove background', attachments: ['/uploads/selected.png'] })
    assert.equal(current().draftContent, session.draftContent)
    assert.deepEqual(current().draftArtifacts, session.draftArtifacts)
    assert.deepEqual(store.getState().imageAttachmentsBySession[session.id], images)
    store.getState().updateDraft(session.novelId, session.id, 'Edited while the image action runs')
    request.resolve()
    await run
    assert.equal(current().draftContent, 'Edited while the image action runs')
    await new Promise((resolve) => setTimeout(resolve, 550))
    assert.equal(saves.at(-1).draftContent, current().draftContent)
    assert.deepEqual(saves.at(-1).draftAttachments, session.draftAttachments)
})
