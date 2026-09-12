const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { createJiti } = require('jiti')

const jiti = createJiti(__filename, { alias: { '@': path.resolve(__dirname, '../..') } })
const file = path.join(__dirname, 'right-panel-codex.tsx')
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const callbacks = new Map()
let queueEffect
function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) callbacks.set(node.name.text, node.getText(source))
    if (ts.isVariableDeclaration(node) && node.initializer) callbacks.set(node.name.getText(source), node.initializer.getText(source))
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('void processQueuedMessage(')) {
        queueEffect = node.arguments[0].getText(source)
    }
    ts.forEachChild(node, visit)
}
visit(source)
function callback(name, dependencies) {
    const value = name === 'queueEffect' ? queueEffect : callbacks.get(name)
    assert.ok(value, `Missing component callback: ${name}`)
    const code = ts.transpileModule(`const callback = ${value};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    return new Function(...Object.keys(dependencies), `${code}\nreturn callback;`)(...Object.values(dependencies))
}

test('queued submissions preserve rejected inputs and pause without replaying accepted messages', async (t) => {
    const { useEditorCodexStore: store, CodexSendError } = await jiti.import('./editor-codex-store.ts')
    const { codexSessionApi: api, ApiError } = await jiti.import('../../lib/api.ts')
    const originalState = store.getState()
    const originalApi = { get: api.get, list: api.list, update: api.update, streamMessage: api.streamMessage }
    t.after(async () => {
        await new Promise((resolve) => setTimeout(resolve, 550))
        Object.assign(api, originalApi)
        store.setState(originalState, true)
    })
    const session = {
        historyLoaded: true, messageCount: 0, previewTitle: '', previewText: '',
        id: 'queue-session', novelId: 'queue-novel', category: 'general', status: 'idle',
        draftContent: '', draftAttachments: [], draftArtifacts: [], messages: [],
        updatedAt: '2026-09-07T00:00:00.000Z', lastError: null,
    }
    const first = { id: 'first', content: 'Keep this instruction', attachments: ['/uploads/a.png'], responseAnnotations: [{ text: 'Selected text', annotation: 'Keep this comment' }], createdAt: session.updatedAt }
    const second = { ...first, id: 'second', content: 'Next instruction', attachments: [], responseAnnotations: [] }
    const current = () => store.getState().sessionsByNovel[session.novelId].sessions[0]
    const queue = () => store.getState().queuedMessagesBySession[session.id]
    const paused = () => store.getState().queuePausedBySession[session.id]
    api.update = async () => ({ session: current() })
    const seed = () => {
        store.setState({
            sessionsByNovel: { [session.novelId]: { sessions: [session], selectedSessionId: session.id, loaded: true, loading: false, error: null } },
            imageAttachmentsBySession: { [session.id]: [] },
            queuedMessagesBySession: { [session.id]: [first, second] },
            queuePausedBySession: {}, queueingEnabledBySession: {},
        })
        api.get = async () => ({ session })
    }
    const render = (running = false) => {
        const state = store.getState()
        const dependencies = {
            CodexSendError, novelId: session.novelId, running,
            sendMessage: state.sendMessage, setRunError: () => {}, ensureSession: async () => session.id,
            setQueuedMessages: state.setQueuedMessages, setQueuePaused: state.setQueuePaused,
            setQueueingEnabled: state.setQueueingEnabled,
            queuedMessagesBySession: state.queuedMessagesBySession, queuePausedBySession: state.queuePausedBySession,
            queueProcessingRef: { current: null }, useEffectEvent: (fn) => fn,
            mergeQueuedCodexMessages: callback('mergeQueuedCodexMessages', {}),
        }
        dependencies.sendContent = callback('sendContent', dependencies)
        const process = callback('processQueuedMessage', dependencies)
        return {
            process,
            toggle: callback('toggleQueueing', dependencies),
            effect: (onProcess) => callback('queueEffect', { ...dependencies, selectedSession: current(), queuePaused: paused(), processQueuedMessage: onProcess })(),
        }
    }

    await t.test('HTTP rejection keeps the complete queue until an explicit resume', async () => {
        seed()
        let requests = 0
        api.streamMessage = async () => { requests += 1; throw new ApiError(400, 'Rejected') }
        await render().process(session.id, first)
        assert.deepEqual(queue(), [first, second])
        assert.equal(paused(), true)
        assert.equal(current().draftContent, '')
        assert.deepEqual(current().messages, [])
        const remounted = render()
        remounted.effect(() => assert.fail('Paused queue must not drain after a render'))
        await remounted.process(session.id, first)
        assert.equal(requests, 1)
        store.getState().setQueuePaused(session.id, false)
        api.streamMessage = async (_id, _content, options) => {
            requests += 1
            options.onEvent({ type: 'done', session: { ...current(), status: 'idle', updatedAt: '2026-09-07T00:01:00.000Z' } })
        }
        let resumed
        const ready = render()
        ready.effect((id, message) => { resumed = ready.process(id, message) })
        await resumed
        assert.equal(requests, 2)
        assert.deepEqual(queue(), [second])
        assert.equal(paused(), false)
        assert.equal(current().messages[0].content, first.content)
        assert.deepEqual(current().messages[0].attachments, first.attachments)
        assert.deepEqual(current().messages[0].responseAnnotations, first.responseAnnotations)
    })

    await t.test('offline submission retains the queue and stops automatic sending', async () => {
        seed()
        api.get = async () => { throw new Error('Offline') }
        api.streamMessage = async () => { throw new Error('Offline') }
        await render().process(session.id, first)
        assert.deepEqual(queue(), [first, second])
        assert.equal(paused(), true)
    })

    for (const scenario of ['streamed failure', 'accepted with lost response']) {
        await t.test(`${scenario} pauses later messages without requeueing the accepted one`, async () => {
            seed()
            api.streamMessage = async (_id, _content, options) => {
                const acceptedSession = { ...current(), status: 'error', updatedAt: '2026-09-07T00:01:00.000Z' }
                if (scenario === 'streamed failure') options.onEvent({ type: 'error', session: acceptedSession, detail: 'Provider failed' })
                else {
                    api.get = async () => ({ session: acceptedSession })
                    throw new Error('Response lost')
                }
            }
            await render().process(session.id, first)
            assert.deepEqual(queue(), [second])
            assert.equal(paused(), true)
            assert.equal(current().messages[0].content, first.content)
        })
    }

    for (const accepted of [false, true]) {
        await t.test(`disabling queueing preserves rejected messages only: accepted=${accepted}`, async () => {
            seed()
            api.streamMessage = async (_id, _content, options) => {
                if (accepted) options.onEvent({ type: 'error', session: { ...current(), status: 'error', updatedAt: '2026-09-07T00:01:00.000Z' }, detail: 'Provider failed' })
                else throw new ApiError(400, 'Rejected')
            }
            await render().toggle(session.id, false)
            assert.deepEqual(queue(), accepted ? [] : [first, second])
            assert.equal(paused(), true)
            if (!accepted) assert.equal(store.getState().queueingEnabledBySession[session.id], true)
        })
    }

    for (const action of ['process', 'disable queueing']) {
        await t.test(`annotation-only queued messages are sent when ${action}`, async () => {
            seed()
            const message = { ...first, content: '', attachments: [] }
            store.getState().setQueuedMessages(session.id, () => [message])
            const requests = []
            api.streamMessage = async (_id, content, options) => {
                requests.push({ content, annotations: options.responseAnnotations })
                options.onEvent({ type: 'done', session: { ...current(), status: 'idle' } })
            }
            if (action === 'process') await render().process(session.id, message)
            else await render().toggle(session.id, false)
            assert.deepEqual(requests, [{ content: '', annotations: first.responseAnnotations }])
            assert.deepEqual(queue(), [])
            assert.equal(Boolean(paused()), false)
        })
    }
})
