const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { PassThrough } = require('node:stream')
const { test } = require('node:test')
const ts = require('typescript')
const { createJiti } = require('jiti')

const src = path.resolve(__dirname, '../..')
const jiti = createJiti(__filename, { alias: { '@': src } })
const pureModules = new Set([
    '@/lib/server/codex-session', '@/lib/server/codex-assistant-text',
    '@/lib/server/codex-live-messages', '@/lib/server/codex-message-projection',
    '@/lib/server/codex-user-input-bridge',
    '@/lib/server/codex-reasoning-stream',
    '@/lib/codex-response-annotations', '@/lib/codex-context-window', '@/lib/codex-config', '@/lib/codex-work-events',
])

function load(relativePath, mocks) {
    const file = path.join(src, relativePath)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    const localRequire = (name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        if (pureModules.has(name)) return jiti(name)
        if (name.startsWith('@/')) return {}
        return require(name)
    }
    new Function('require', 'module', 'exports', output)(localRequire, module, module.exports)
    return module.exports
}

test('annotation-only steering reaches the active turn through the route', async (t) => {
    const annotations = [{ text: 'Selected text', annotation: 'Check this claim.', source: { messageId: 'reply', startOffset: 0, endOffset: 13 } }]
    const server = load('lib/server/codex-app-server.ts', {
        '@/lib/db': { getPrismaClient: () => ({}) },
    })
    const sessionId = 'annotation-steer'
    const activeRun = server.reserveActiveCodexRun(sessionId)
    t.after(() => server.finishActiveCodexRun(activeRun))
    const requests = []
    const events = []
    Object.assign(activeRun, {
        threadId: 'thread', turnId: 'turn', emitEvent: (event) => events.push(event),
        client: { request: async (method, params) => { requests.push({ method, params }); return { turnId: 'turn' } } },
    })
    const route = load('app/api/codex/sessions/[id]/steer/route.ts', {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/db': { getPrismaClient: () => ({ codexSession: { findFirst: async () => ({ id: sessionId, status: 'running' }) } }) },
        '@/lib/server/codex-app-server': server,
        '@/lib/server/storage': { normalizeManagedAttachmentUrls: () => [] },
    })
    const send = (responseAnnotations) => route.POST(new Request('http://localhost/steer', {
        method: 'POST', body: JSON.stringify({ content: '  ', responseAnnotations }),
    }), { params: Promise.resolve({ id: sessionId }) })
    for (const empty of [[], [{ text: '  ' }]]) assert.equal((await send(empty)).status, 400)
    await assert.rejects(server.steerActiveCodexRun({ sessionId, message: '  ' }), /Steer message is required/)
    assert.equal(requests.length, 0)
    assert.equal((await send(annotations)).status, 200)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'turn/steer')
    assert.ok(requests[0].params.input[0].text.includes(JSON.stringify(annotations)))
    assert.equal(events[0].content, '')
    assert.deepEqual(events[0].responseAnnotations, annotations)
})

for (const composerMode of ['default', 'plan']) {
    test(`async questions stay separate from assistant text in ${composerMode} mode`, { timeout: 5000 }, async (t) => {
        const bridge = jiti('@/lib/server/codex-user-input-bridge')
        const child = new EventEmitter()
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        child.kill = () => {}
        const emit = (message) => child.stdout.write(JSON.stringify(message) + '\n')
        const notify = (method, params) => emit({ method, params: { threadId: 'thread', turnId: 'turn', ...params } })
        const question = { title: '如果能去一个地方住一个月，你会选哪里？', options: ['海边小城', '山中木屋', '繁华都市'] }
        const finalText = '已发出一个小问题，可以选择选项，也可以自由填写答案。'
        const noticeText = '后台检查已完成。'
        const questions = []
        const deltas = []
        const reasoningDeltas = []
        const reasoningEvents = []
        const imageViewEvents = []
        const steers = []
        const resolved = []
        let replay
        let answerResult
        child.stdin = { write: (line) => {
            const message = JSON.parse(line)
            if (message.method === 'turn/steer') steers.push(message.params)
            const result = message.method === 'thread/start' ? { thread: { id: 'thread' } }
                : message.method === 'turn/start' ? { turn: { id: 'turn' } }
                    : message.method === 'config/read' ? { config: {} } : {}
            queueMicrotask(() => emit({ id: message.id, result }))
            if (message.method === 'turn/start') replay = (async () => {
                await new Promise(setImmediate)
                notify('item/reasoning/summaryTextDelta', { itemId: 'reasoning', summaryIndex: 0, delta: 'Plan the scene' })
                notify('item/reasoning/textDelta', { threadId: 'another-thread', itemId: 'wrong-thread', contentIndex: 0, delta: 'Ignore' })
                notify('item/reasoning/textDelta', { turnId: 'another-turn', itemId: 'wrong-turn', contentIndex: 0, delta: 'Ignore' })
                notify('item/completed', { item: { type: 'reasoning', id: 'reasoning', summary: ['Plan the complete scene'], content: [] } })
                notify('item/started', { item: { type: 'imageView', id: 'view-image', path: '/workspace/portrait.png' } })
                notify('item/completed', { item: { type: 'imageView', id: 'view-image', path: '/workspace/portrait.png' } })
                notify('item/completed', { item: {
                    type: 'agentMessage', id: 'question-item', delivery: 'async', phase: 'final_answer',
                    text: [question.title, ...question.options.map((option) => `- ${option}`)].join('\n'),
                    questions: [question],
                } })
                await new Promise(setImmediate)
                const pending = bridge.listCodexUserInputRequests(sessionId)[0]
                if (pending) answerResult = await bridge.resolveCodexUserInput(sessionId, pending.id, {
                    answers: { 'question-item:0': { answers: ['海边小城'] } },
                })
                notify('item/agentMessage/delta', { itemId: 'reply', delta: finalText })
                notify('item/completed', { item: { type: 'agentMessage', id: 'reply', text: finalText } })
                notify('item/completed', { item: {
                    type: 'agentMessage', id: 'notice', delivery: 'async', questions: [], text: noticeText,
                } })
                notify('turn/completed', { turn: { id: 'turn', status: 'completed' } })
            })()
        } }
        const server = load('lib/server/codex-app-server.ts', {
            child_process: { spawn: () => child },
            '@/lib/db': { getPrismaClient: () => ({
                codexConnection: { findFirst: async () => ({ id: 'connection', providerType: 'openai-official' }) },
                novel: { findFirstOrThrow: async () => ({ codexUserInputEnabled: true }) },
            }) },
            '@/lib/server/codex-connection-storage': { ensureCodexConnectionHome: async () => '/unused-codex-home' },
            '@/lib/server/codex-session-workspace': { ensureCodexSessionWorkspace: async () => '/unused-workspace' },
            '@/lib/server/novel-workspace': { getNovelWorkspacePath: () => '/unused-novel' },
            '@/lib/server/codex-runtime-sandbox': {
                getCodexRuntimeSandbox: () => 'read-only', getCodexRuntimeWorkspaceRoots: () => [],
                getCodexRuntimeSandboxPolicy: () => ({ type: 'readOnly' }),
            },
            '@/lib/server/codex-mcp-sync': { syncCodexConnectionMcp: async () => {} },
            '@/lib/server/codex-question-policy': { prepareCodexQuestionPolicy: async () => ({ config: {} }) },
        })
        const sessionId = `question-text-${composerMode}`
        const activeRun = server.reserveActiveCodexRun(sessionId)
        t.after(() => server.finishActiveCodexRun(activeRun))
        const result = await server.runNovelCodexTurn({
            activeRun, sessionId, ownerId: 'owner', novelId: 'novel', modelId: 'gpt-6-astra',
            composerMode, serviceTier: 'standard', prompt: '随便问我一个问题。',
            stream: {
                onUserInputRequest: (request) => questions.push(request),
                onUserInputResolved: (id) => resolved.push(id),
                onAssistantDelta: (delta) => deltas.push(delta),
                onReasoningDelta: (event) => reasoningDeltas.push(event),
                onEvent: (event) => {
                    if (event.kind === 'reasoning') reasoningEvents.push(event)
                    if (event.kind === 'image_view') imageViewEvents.push(event)
                },
            },
        })
        await replay
        assert.equal(questions.length, 1)
        assert.equal(questions[0].delivery, 'async-message')
        assert.equal(questions[0].questions[0].question, question.title)
        assert.deepEqual(questions[0].questions[0].options.map((option) => option.label), question.options)
        assert.equal(answerResult.ok, true)
        assert.equal(steers[0].input[0].text, `${question.title}\n海边小城`)
        assert.deepEqual(resolved, [questions[0].id])
        assert.deepEqual(deltas, [finalText, noticeText])
        assert.deepEqual(reasoningDeltas.map((event) => event.delta), ['Plan the scene'])
        assert.deepEqual(reasoningEvents.map((event) => event.content), ['Plan the complete scene'])
        assert.deepEqual(imageViewEvents.map((event) => event.workStatus), ['running', 'completed'])
        assert.equal(result.assistantText, finalText + noticeText)
        assert.deepEqual(bridge.listCodexUserInputRequests(sessionId), [])
    })
}

for (const serviceTier of ['fast', 'standard']) {
    test(`changing speed to ${serviceTier} updates the active turn and future turns without interrupting`, async (t) => {
        const runtime = load('lib/server/codex-app-server.ts', {
            '@/lib/db': { getPrismaClient: () => ({}) },
        })
        const run = runtime.reserveActiveCodexRun(`speed-${serviceTier}`)
        t.after(() => runtime.finishActiveCodexRun(run))
        const requests = []
        run.threadId = 'thread'
        run.turnId = 'turn'
        run.client = { request: async (method, params) => {
            if (method === 'model/list') return { data: [{
                model: 'test-model', defaultReasoningEffort: 'high',
                serviceTiers: [{ id: 'priority', name: 'Fast' }],
            }] }
            requests.push({ method, params })
            return method === 'turn/settings/update' ? { status: 'applied' } : {}
        } }

        await runtime.updateActiveCodexServiceTier({ sessionId: run.sessionId, modelId: 'test-model', serviceTier })

        const tierId = serviceTier === 'fast' ? 'priority' : null
        assert.deepEqual(requests, [
            { method: 'thread/settings/update', params: { threadId: 'thread', serviceTier: tierId } },
            { method: 'turn/settings/update', params: { threadId: 'thread', turnId: 'turn', serviceTier: tierId } },
        ])
        assert.equal(run.stopped, false)
        assert.equal(runtime.getActiveCodexRun(run.sessionId), run)
    })

    test(`saving ${serviceTier} while running preserves the session's draft and streamed messages`, async () => {
        const now = new Date()
        let row = {
            id: 'session', ownerId: 'owner', novelId: 'novel', codexConnectionId: 'connection', status: 'running', modelId: 'test-model',
            serviceTier: serviceTier === 'fast' ? 'standard' : 'fast',
            draftContent: 'Next message', createdAt: now, updatedAt: now,
            messagesJson: JSON.stringify([{ id: 'partial', role: 'assistant', content: 'Working...', createdAt: now.toISOString() }]),
        }
        const originalMessages = row.messagesJson
        const events = []
        const route = load('app/api/codex/sessions/[id]/route.ts', {
            '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
            '@/lib/db': { getPrismaClient: () => ({ codexSession: {
                findFirst: async () => row,
                update: async ({ data }) => { events.push('persist'); row = { ...row, ...data }; return row },
            },
                codexConnection: { findFirst: async () => ({ providerType: 'openai-official', authStatus: 'authenticated', authType: 'chatgpt' }) },
                novel: { findFirstOrThrow: async () => ({ codexCustomFastModeEnabled: false }) },
            }) },
            '@/lib/server/codex-app-server': { updateActiveCodexServiceTier: async (input) => {
                assert.deepEqual(input, { sessionId: 'session', modelId: 'test-model', serviceTier })
                events.push('update runtime')
            } },
        })

        const response = await route.PATCH(new Request('http://localhost/session', {
            method: 'PATCH', body: JSON.stringify({ serviceTier }),
        }), { params: Promise.resolve({ id: 'session' }) })

        assert.equal(response.status, 200)
        assert.deepEqual(events, ['update runtime', 'persist'])
        const { session } = await response.json()
        assert.equal(session.serviceTier, serviceTier)
        assert.equal(session.status, 'running')
        assert.equal(session.draftContent, 'Next message')
        assert.equal(row.messagesJson, originalMessages)
    })
}

test('changing speed without an active run leaves runtime startup to the saved session settings', async () => {
    const runtime = load('lib/server/codex-app-server.ts', {
        '@/lib/db': { getPrismaClient: () => ({}) },
    })
    await runtime.updateActiveCodexServiceTier({ sessionId: 'idle-speed', modelId: 'test-model', serviceTier: 'fast' })
    assert.equal(runtime.getActiveCodexRun('idle-speed'), null)
})

for (const scenario of ['first thread', 'updated goal', 'cleared goal', 'inactive goal']) {
    test(`stopping preserves terminal state: ${scenario}`, async () => {
        const now = new Date()
        const goal = { threadId: 'thread', objective: 'Write', status: 'active', tokenBudget: 1000, tokensUsed: 10, timeUsedSeconds: 2, createdAt: 1, updatedAt: 2 }
        let row = {
            id: 'session', ownerId: 'owner', novelId: 'novel', status: 'running',
            codexThreadId: scenario === 'first thread' ? null : 'thread', codexConnectionId: 'connection',
            goalJson: scenario === 'first thread' ? null : JSON.stringify(goal),
            messagesJson: '[]', createdAt: now, updatedAt: now,
        }
        const pausedGoal = { ...goal, status: 'paused' }
        const latestGoal = { ...pausedGoal, tokensUsed: 99, timeUsedSeconds: 20 }
        let pauseCalls = 0
        const route = load('app/api/codex/sessions/[id]/stop/route.ts', {
            '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
            '@/lib/db': { getPrismaClient: () => ({ codexSession: {
                findFirst: async () => ({ ...row }),
                update: async ({ data }) => { row = { ...row, ...data }; return row },
            } }) },
            '@/lib/server/codex-app-server': {
                updateNovelCodexGoal: async ({ status }) => {
                    assert.equal(status, 'paused')
                    pauseCalls += 1
                    return { goal: pausedGoal }
                },
                interruptAndWaitForActiveCodexRun: async () => {
                    if (scenario === 'inactive goal') return false
                    row = {
                        ...row, codexThreadId: 'thread', status: 'idle',
                        messagesJson: '[{"id":"partial","role":"assistant","content":"Saved answer","createdAt":"2026-09-07T00:00:00Z"}]',
                        goalJson: scenario === 'updated goal' ? JSON.stringify(latestGoal) : null,
                    }
                    return true
                },
            },
        })
        const response = await route.POST(new Request('http://localhost/stop', { method: 'POST' }), { params: Promise.resolve({ id: 'session' }) })
        assert.equal(response.status, 200)
        const { session } = await response.json()
        assert.equal(session.codexThreadId, 'thread')
        assert.equal(session.status, 'idle')
        assert.equal(pauseCalls, scenario === 'first thread' ? 0 : 1)
        assert.deepEqual(session.goal, scenario === 'updated goal' ? latestGoal : scenario === 'inactive goal' ? pausedGoal : null)
        if (scenario !== 'inactive goal') assert.equal(session.messages[0].content, 'Saved answer')
    })
}

test('a failed turn persists partial assistant output and tool events after pending checkpoints', async () => {
    const now = new Date()
    let row = {
        id: 'session', ownerId: 'owner', novelId: 'novel', category: 'general',
        status: 'idle', composerMode: 'default', messagesJson: '[]',
        draftAttachmentsJson: '[]', draftArtifactsJson: '[]',
        createdAt: now, updatedAt: now,
    }
    const writes = []
    let releaseCheckpoint
    const checkpoint = new Promise((resolve) => { releaseCheckpoint = resolve })
    const route = load('app/api/codex/sessions/[id]/messages/route.ts', {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/db': { getPrismaClient: () => ({ codexSession: {
            findFirst: async () => row,
            updateMany: async ({ data }) => {
                if (data.messagesJson) await checkpoint
                row = { ...row, ...data }
                writes.push(data)
                return { count: 1 }
            },
            update: async ({ data }) => { row = { ...row, ...data }; writes.push(data); return row },
        } }) },
        '@/lib/server/storage': { normalizeManagedAttachmentUrls: () => [] },
        '@/lib/server/codex-session-workspace': { getCodexSessionWorkspacePath: () => '/unused' },
        '@/lib/server/codex-app-server': {
            reserveActiveCodexRun: () => ({}), finishActiveCodexRun: () => {},
            isCodexRunInterruptedError: () => false,
            runNovelCodexTurn: async ({ stream }) => {
                stream.onReasoningDelta({ id: 'reasoning', delta: 'First thought', createdAt: now.toISOString() })
                stream.onAssistantDelta('Partial answer')
                stream.onEvent({ id: 'tool', kind: 'tool', title: 'Read manuscript', content: 'Tool output', workStatus: 'completed', toolInput: '{"sceneId":"scene"}', createdAt: now.toISOString() })
                stream.onReasoningDelta({ id: 'reasoning', delta: ' continues', createdAt: now.toISOString() })
                stream.onEvent({ id: 'reasoning', kind: 'reasoning', title: '', content: 'Finalized thought', workStatus: 'completed', createdAt: now.toISOString() })
                stream.onReasoningDelta({ id: 'partial-reasoning', delta: 'Unfinished thought', createdAt: now.toISOString() })
                stream.onTurnCompleted()
                setTimeout(releaseCheckpoint, 10)
                throw new Error('Provider failed')
            },
        },
    })
    const response = await route.POST(new Request('http://localhost/messages', {
        method: 'POST', body: JSON.stringify({ messageId: 'submitted-message', content: 'Continue' }),
    }), { params: Promise.resolve({ id: 'session' }) })
    const body = await response.text()
    assert.match(body, /event: error/)
    assert.match(body, /event: reasoning_delta/)
    assert.equal(row.status, 'error')
    assert.equal(writes.at(-1).status, 'error')
    const messages = JSON.parse(row.messagesJson)
    assert.equal(messages[0].id, 'submitted-message')
    assert.equal(messages[1].id, 'reasoning')
    assert.equal(messages[1].content, 'Finalized thought')
    assert.equal(messages.find((message) => message.id === 'partial-reasoning').content, 'Unfinished thought')
    assert.equal(messages.find((message) => message.role === 'assistant').content, 'Partial answer')
    assert.match(messages.find((message) => message.id === 'tool').content, /Tool output/)
    assert.equal(messages.find((message) => message.id === 'tool').workStatus, 'completed')
    assert.equal(messages.find((message) => message.id === 'tool').toolInput, '{"sceneId":"scene"}')
    assert.equal(messages.at(-1).kind, 'error')
    assert.equal(messages.at(-1).content, 'Provider failed')
})

for (const status of ['failed', 'completed', 'interrupted', 'unexpected']) {
    test(`compaction handles a ${status} terminal notification`, { timeout: 2000 }, async () => {
        const child = new EventEmitter()
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        child.kill = () => {}
        const emit = (message) => child.stdout.write(JSON.stringify(message) + '\n')
        child.stdin = { write: (line) => {
            const message = JSON.parse(line)
            queueMicrotask(() => {
                emit({ id: message.id, result: message.method === 'thread/resume' ? { thread: { id: 'thread' } } : {} })
                if (message.method === 'thread/compact/start') {
                    emit({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } })
                    emit({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status, error: { message: 'Compaction provider failed' } } } })
                }
            })
        } }
        const server = load('lib/server/codex-app-server.ts', {
            child_process: { spawn: () => child },
            '@/lib/db': { getPrismaClient: () => ({
                codexConnection: { findFirst: async () => ({ id: 'connection', providerType: 'openai-official' }) },
                novel: { findFirstOrThrow: async () => ({ codexCustomFastModeEnabled: false }) },
            }) },
            '@/lib/server/codex-connection-storage': { ensureCodexConnectionHome: async () => '/unused-codex-home' },
            '@/lib/server/codex-session-workspace': { ensureCodexSessionWorkspace: async () => '/unused-workspace' },
            '@/lib/server/novel-workspace': { getNovelWorkspacePath: () => '/unused-novel' },
            '@/lib/server/codex-runtime-sandbox': { getCodexRuntimeSandbox: () => 'read-only', getCodexRuntimeWorkspaceRoots: () => [] },
        })
        const sessionId = `compact-${status}`
        const activeRun = server.reserveActiveCodexRun(sessionId)
        const events = []
        try {
            const result = server.runNovelCodexCompaction({
                activeRun, sessionId, ownerId: 'owner', novelId: 'novel', codexThreadId: 'thread',
                stream: { onEvent: (event) => events.push(event) },
            })
            if (status === 'failed' || status === 'unexpected') {
                await assert.rejects(result, status === 'failed' ? /Compaction provider failed/ : /unexpected status/)
                assert.equal(events.some((event) => event.content === 'done'), false)
            } else {
                assert.equal((await result).status, status)
            }
        } finally {
            server.finishActiveCodexRun(activeRun)
        }
    })
}

for (const scenario of ['success', 'no active connection', 'running conversation', 'copy failure', 'transaction failure', 'unused connection']) {
    test(`connection deletion: ${scenario}`, async () => {
        const source = { id: 'source', ownerId: 'owner', providerType: 'custom', defaultModelId: 'old-model', modelsJson: '[]' }
        const target = { ...source, id: 'target', providerType: 'openai-official', defaultModelId: 'gpt-5.4' }
        const original = { id: 'session', codexThreadId: 'thread', codexConnectionId: source.id, messagesJson: '["history"]', goalJson: '{"tokensUsed":321}', draftContent: 'Next message', modelId: 'old-model', serviceTier: 'fast' }
        let session = { ...original }
        const events = []
        const reserved = new Set()
        const db = {
            codexSession: {
                findMany: async () => scenario === 'unused connection' ? [] : [session],
                updateMany: async ({ data }) => { events.push('rebind'); session = { ...session, ...data }; return { count: 1 } },
            },
            codexConnection: {
                findFirst: async () => scenario === 'no active connection' ? null : target,
                delete: async () => { events.push('delete row') },
            },
            $transaction: async (run) => {
                if (scenario === 'transaction failure') throw new Error('Transaction failed')
                return run(db)
            },
        }
        const service = load('lib/server/codex-session-rebind.ts', {
            '@/lib/db': { getPrismaClient: () => db },
            '@/lib/server/codex-app-server': {
                reserveActiveCodexRun: (id) => {
                    if (scenario === 'running conversation') return null
                    reserved.add(id)
                    return { sessionId: id }
                },
                finishActiveCodexRun: ({ sessionId }) => reserved.delete(sessionId),
                initializeCodexConnectionState: async () => {},
            },
            '@/lib/server/codex-connection-storage': {
                ensureCodexConnectionHome: async (_owner, id) => `/homes/${id}`,
                deleteCodexConnectionHome: async () => { events.push('delete home') },
            },
            '@/lib/server/codex-connection-transfer': {
                transferCodexConnectionThreads: async (from, to, ids) => {
                    assert.equal(from, '/homes/source')
                    assert.equal(to, '/homes/target')
                    assert.deepEqual(ids, ['thread'])
                    assert.equal(reserved.has('session'), true)
                    if (scenario === 'copy failure') throw new Error('Copy failed')
                    events.push('copy')
                },
            },
        })
        const deletion = service.deleteCodexConnectionPreservingSessions(source)
        if (scenario === 'success') {
            await deletion
            assert.deepEqual(events, ['copy', 'rebind', 'delete row', 'delete home'])
            assert.equal(session.codexConnectionId, target.id)
            assert.equal(session.codexThreadId, original.codexThreadId)
            assert.equal(session.messagesJson, original.messagesJson)
            assert.equal(session.goalJson, original.goalJson)
            assert.equal(session.draftContent, original.draftContent)
            assert.equal(session.modelId, target.defaultModelId)
            assert.equal(session.reasoningEffort, 'high')
            assert.equal(session.serviceTier, 'standard')
        } else if (scenario === 'unused connection') {
            await deletion
            assert.deepEqual(events, ['delete row', 'delete home'])
        } else {
            await assert.rejects(deletion, /Activate another|Stop the running|Copy failed|Transaction failed/)
            assert.equal(events.includes('delete row'), false)
            assert.equal(events.includes('delete home'), false)
            assert.deepEqual(session, original)
        }
        assert.equal(reserved.size, 0)
    })
}

for (const { providerType, allowed, expected } of [
    { providerType: 'openai-official', allowed: false, expected: 'upstream-fast' },
    { providerType: 'custom', allowed: false, expected: null },
    { providerType: 'custom', allowed: true, expected: 'upstream-fast' },
]) {
    for (const operation of ['new turn', 'resumed turn', 'compaction']) {
        test(`${operation} with ${providerType} and third-party Fast ${allowed} sends the allowed tier`, { timeout: 3000 }, async (t) => {
            const child = new EventEmitter()
            child.stdout = new PassThrough()
            child.stderr = new PassThrough()
            child.kill = () => {}
            const requests = []
            const emit = (message) => child.stdout.write(JSON.stringify(message) + '\n')
            child.stdin = { write: (line) => {
                const message = JSON.parse(line)
                requests.push(message)
                const result = message.method === 'model/list' ? { data: [{
                    model: 'test-model', defaultReasoningEffort: 'high', serviceTiers: [{ id: 'upstream-fast', name: 'Fast' }],
                }] } : message.method === 'thread/start' || message.method === 'thread/resume' ? { thread: { id: 'thread' } }
                    : message.method === 'turn/start' ? { turn: { id: 'turn' } }
                        : message.method === 'config/read' ? { config: {} } : {}
                queueMicrotask(() => emit({ id: message.id, result }))
                if (message.method === 'turn/start' || message.method === 'thread/compact/start') {
                    setImmediate(() => emit({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } }))
                }
            } }
            const runtime = load('lib/server/codex-app-server.ts', {
                child_process: { spawn: () => child },
                '@/lib/db': { getPrismaClient: () => ({
                    codexConnection: { findFirst: async () => ({ id: 'connection', providerType, authStatus: 'authenticated', authType: 'chatgpt' }) },
                    novel: { findFirstOrThrow: async () => ({ codexUserInputEnabled: true, codexCustomFastModeEnabled: allowed }) },
                }) },
                '@/lib/server/codex-connection-storage': { ensureCodexConnectionHome: async () => '/unused-codex-home' },
                '@/lib/server/codex-runtime-config': { syncCodexConnectionRuntimeFiles: async () => '/unused-codex-home' },
                '@/lib/server/codex-session-workspace': { ensureCodexSessionWorkspace: async () => '/unused-workspace' },
                '@/lib/server/novel-workspace': { getNovelWorkspacePath: () => '/unused-novel' },
                '@/lib/server/codex-runtime-sandbox': {
                    getCodexRuntimeSandbox: () => 'read-only', getCodexRuntimeWorkspaceRoots: () => [],
                    getCodexRuntimeSandboxPolicy: () => ({ type: 'readOnly' }),
                },
                '@/lib/server/codex-mcp-sync': { syncCodexConnectionMcp: async () => {} },
                '@/lib/server/codex-question-policy': { prepareCodexQuestionPolicy: async () => ({ config: {} }) },
            })
            const run = runtime.reserveActiveCodexRun(`fast-${providerType}-${allowed}-${operation}`)
            t.after(() => runtime.finishActiveCodexRun(run))
            const input = {
                activeRun: run, sessionId: run.sessionId, ownerId: 'owner', novelId: 'novel', modelId: 'test-model',
                serviceTier: 'fast', codexThreadId: operation === 'new turn' ? null : 'thread', prompt: 'Write a scene.',
            }
            await (operation === 'compaction' ? runtime.runNovelCodexCompaction(input) : runtime.runNovelCodexTurn(input))
            const tierRequests = requests.filter(({ method }) => ['thread/start', 'thread/resume', 'turn/start'].includes(method))
            assert.equal(tierRequests.length, operation === 'compaction' ? 1 : 2)
            for (const request of tierRequests) assert.equal(request.params.serviceTier, expected)
        })
    }
}

for (const allowed of [false, true]) {
    test(`changing a third-party session speed respects its novel's Fast setting ${allowed}`, async () => {
        const now = new Date()
        let row = { id: 'session', ownerId: 'owner', novelId: 'novel', codexConnectionId: 'bound-connection', modelId: 'test-model', createdAt: now, updatedAt: now }
        const expectedTier = allowed ? 'fast' : 'standard'
        const runtimeTiers = []
        const route = load('app/api/codex/sessions/[id]/route.ts', {
            '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
            '@/lib/db': { getPrismaClient: () => ({
                codexSession: { findFirst: async () => row, update: async ({ data }) => (row = { ...row, ...data }) },
                codexConnection: { findFirst: async ({ where }) => {
                    assert.deepEqual(where, { id: 'bound-connection', ownerId: 'owner' })
                    return { providerType: 'custom', authStatus: 'authenticated', authType: 'apiKey' }
                } },
                novel: { findFirstOrThrow: async ({ where }) => {
                    assert.deepEqual(where, { id: 'novel', ownerId: 'owner' })
                    return { codexCustomFastModeEnabled: allowed }
                } },
            }) },
            '@/lib/server/codex-app-server': { updateActiveCodexServiceTier: async ({ serviceTier }) => runtimeTiers.push(serviceTier) },
        })
        const response = await route.PATCH(new Request('http://localhost/session', {
            method: 'PATCH', body: JSON.stringify({ serviceTier: 'fast' }),
        }), { params: Promise.resolve({ id: 'session' }) })
        assert.equal(response.status, 200)
        assert.equal((await response.json()).session.serviceTier, expectedTier)
        assert.deepEqual(runtimeTiers, [expectedTier])
    })
}

test('novel Fast permission saves both values, rejects non-booleans, and survives unrelated updates', async () => {
    let row = { id: 'novel', codexCustomFastModeEnabled: false, codexUserInputEnabled: true, codexSessionRetentionLimit: 10 }
    let writes = 0
    const route = load('app/api/novels/[id]/route.ts', {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/db': { prisma: {
            novel: { findFirst: async () => row, update: async ({ data }) => { writes++; return row = { ...row, ...data } } },
            $transaction: async (operations) => Promise.all(operations),
        } },
        '@/lib/server/novel-workspace': { ensureNovelWorkspace: async () => {} },
    })
    const save = (body) => route.PUT(new Request('http://localhost/novel', { method: 'PUT', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'novel' }) })
    for (const value of [true, false]) {
        const response = await save({ codexCustomFastModeEnabled: value })
        assert.equal(response.status, 200)
        assert.equal((await response.json()).codexCustomFastModeEnabled, value)
    }
    await save({ codexCustomFastModeEnabled: true })
    const unrelated = await save({ title: 'New title' })
    assert.equal((await unrelated.json()).codexCustomFastModeEnabled, true)
    for (const value of ['true', 1, null]) assert.equal((await save({ codexCustomFastModeEnabled: value })).status, 400)
    assert.equal(writes, 4)
})
