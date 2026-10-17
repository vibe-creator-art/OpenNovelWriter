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
const { isSkillAvailableInSession } = jiti('@/lib/skills')
const { codexConfigOverrideArgs } = jiti('@/lib/server/codex-config-overrides')
const skills = [
    { id: 'chat', name: 'Chat writer', category: 'ai_chat', enabled: true },
    { id: 'continuation', name: 'Panel writer', category: 'scene_continuation', enabled: true },
    { id: 'action', name: 'Scene action', category: 'scene_action', enabled: true },
    { id: 'disabled', name: 'Disabled writer', category: 'ai_chat', enabled: false },
]
const sessionCategories = { general: 'chat', scene_continuation: 'continuation', scene_operation: 'action' }

function load(relative, mocks) {
    const output = ts.transpileModule(fs.readFileSync(path.join(src, relative), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    new Function('require', 'module', 'exports', output)((name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        if (name === '@/lib/server/continuation-handoff') return {}
        if (name === '@/lib/server/novel-workspace') return { getNovelWorkspacePath: () => '/novel-workspace' }
        return name.startsWith('@/') ? jiti(name) : require(name)
    }, module, module.exports)
    return module.exports
}

function fixture() {
    const reads = []
    const service = load('lib/server/codex-session-skills.ts', {
        '@/lib/db': { getPrismaClient: () => ({ codexSession: { findFirstOrThrow: async ({ where }) => {
            assert.equal(where.ownerId, 'owner')
            return { category: where.id }
        } } }) },
        '@/lib/server/skill-storage': {
            getUserSkillsRoot: (owner) => `/library/${owner}`,
            listSkills: async () => skills,
            readSkill: async (owner, id) => {
                reads.push({ owner, id })
                const skill = skills.find((skill) => skill.id === id)
                if (owner !== 'owner' || !skill) throw new Error('Not found')
                return skill
            },
        },
    })
    return { service, reads }
}

test('menu and concurrent runtime configurations agree on all three session categories', async () => {
    const { service } = fixture()
    const before = JSON.stringify(skills)
    await Promise.all(Object.entries(sessionCategories).map(async ([category, expected]) => {
        const config = await service.getCodexSessionSkillConfig('owner', category)
        assert.deepEqual(skills.filter((skill) => isSkillAvailableInSession(skill, category)).map((skill) => skill.id), [expected])
        assert.deepEqual(config['skills.config'].filter((entry) => entry.enabled).map((entry) => entry.path), [`/library/owner/${expected}/SKILL.md`])
        assert.equal(config['skills.config'].length, skills.length)
    }))
    assert.equal(JSON.stringify(skills), before)
    assert.equal(isSkillAvailableInSession(skills[0], 'unknown'), false)
    await assert.rejects(service.getCodexSessionSkillConfig('owner', 'unknown'), /Unsupported/)
})

test('references reject other categories, disabled skills and unavailable owner-scoped IDs', async () => {
    const { service } = fixture()
    for (const [category, allowedId] of Object.entries(sessionCategories)) {
        for (const id of [...skills.map((skill) => skill.id), 'foreign']) {
            const request = { ownerId: 'owner', sessionCategory: category, content: `[Any label](skill:${id})`, skillIds: [id] }
            if (id === allowedId) {
                const refs = await service.resolveCodexSessionSkillReferences(request)
                assert.equal(refs.length, 1)
                assert.equal(refs[0].path, `/library/owner/${id}/SKILL.md`)
                assert.equal(service.rewriteCodexSkillReferences(request.content, refs), `$${refs[0].name}`)
            } else {
                await assert.rejects(service.resolveCodexSessionSkillReferences(request), service.CodexSkillUnavailableError)
            }
        }
    }
    await assert.rejects(service.resolveCodexSessionSkillReferences({ ownerId: 'other', sessionCategory: 'general', content: '', skillIds: ['chat'] }), service.CodexSkillUnavailableError)
    assert.deepEqual(await service.resolveCodexSessionSkillReferences({ ownerId: 'owner', sessionCategory: 'general', content: 'No skill selected' }), [])
})

for (const endpoint of ['messages', 'steer']) {
    test(`${endpoint} rejects cross-category references before starting or steering a turn`, async () => {
        const { service } = fixture()
        let calls = 0
        const route = load(`app/api/codex/sessions/[id]/${endpoint}/route.ts`, {
            '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
            '@/lib/db': { getPrismaClient: () => ({ codexSession: { findFirst: async () => ({
                id: 'session', category: 'scene_continuation', status: 'running', composerMode: 'default',
            }) } }) },
            '@/lib/server/codex-session-skills': service,
            '@/lib/server/codex-app-server': {
                reserveActiveCodexRun: () => { calls++; throw new Error('Should not start') },
                steerActiveCodexRun: async () => { calls++ },
            },
            '@/lib/server/codex-session-workspace': { getCodexSessionWorkspacePath: () => '/unused' },
        })
        for (const body of [
            { content: '[Chat](skill:chat)' },
            { content: 'Continue', skillIds: ['chat'] },
            { content: '[Panel](skill:continuation)', skillIds: ['action'] },
        ]) {
            const response = await route.POST(new Request('http://localhost/test', {
                method: 'POST', body: JSON.stringify({ messageId: 'message', ...body }),
            }), { params: Promise.resolve({ id: 'session' }) })
            assert.equal(response.status, 400)
            assert.match((await response.json()).detail, /not available in this session/)
        }
        assert.equal(calls, 0)
    })
}

function runtimeFixture(category, questionsEnabled = true, baseUrl) {
    const { service } = fixture()
    const spawns = []
    const requests = []
    const runtime = load('lib/server/codex-app-server.ts', {
        child_process: { spawn: (_command, args) => {
            spawns.push(args)
            const child = new EventEmitter()
            child.stdout = new PassThrough()
            child.stderr = new PassThrough()
            child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); return true }
            const emit = (message) => child.stdout.write(JSON.stringify(message) + '\n')
            child.stdin = { write: (line) => {
                const request = JSON.parse(line)
                requests.push(request)
                const result = ['thread/start', 'thread/resume'].includes(request.method) ? { thread: { id: 'thread' } }
                    : request.method === 'turn/start' ? { turn: { id: 'turn' } }
                        : request.method === 'config/read' ? { config: {} } : {}
                queueMicrotask(() => emit({ id: request.id, result }))
                if (['turn/start', 'thread/compact/start'].includes(request.method)) {
                    setImmediate(() => emit({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } }))
                }
            } }
            return child
        } },
        '@/lib/db': { getPrismaClient: () => ({
            codexConnection: { findFirst: async () => ({ id: 'connection', providerType: 'custom', baseUrl }) },
            novel: { findFirstOrThrow: async () => ({ codexUserInputEnabled: questionsEnabled }) },
        }) },
        '@/lib/server/codex-session-skills': service,
        '@/lib/server/codex-runtime-config': { syncCodexConnectionRuntimeFiles: async () => '/shared-codex-home' },
        '@/lib/server/codex-session-workspace': { ensureCodexSessionWorkspace: async () => '/session-workspace' },
        '@/lib/server/codex-mcp-sync': { syncCodexConnectionMcp: async () => {} },
        '@/lib/server/codex-question-policy': { prepareCodexQuestionPolicy: async () => ({ config: { 'features.default_mode_request_user_input': questionsEnabled } }) },
    })
    return { runtime, service, spawns, requests, category }
}

for (const category of Object.keys(sessionCategories)) {
    for (const operation of ['new', 'resume', 'compact']) {
        test(`${category} ${operation} applies its scope to the process and thread`, async (t) => {
            const { runtime, service, spawns, requests } = runtimeFixture(category, operation !== 'resume')
            const run = runtime.reserveActiveCodexRun(category)
            t.after(() => runtime.finishActiveCodexRun(run))
            const expected = await service.getCodexSessionSkillConfig('owner', category)
            const refs = await service.resolveCodexSessionSkillReferences({ ownerId: 'owner', sessionCategory: category, content: '', skillIds: [sessionCategories[category]] })
            const input = { activeRun: run, sessionId: category, ownerId: 'owner', novelId: 'novel',
                modelId: 'test-model', codexThreadId: operation === 'new' ? null : 'thread', prompt: 'Write', skillRefs: refs }
            await (operation === 'compact' ? runtime.runNovelCodexCompaction(input) : runtime.runNovelCodexTurn(input))
            assert.equal(spawns.length, operation === 'resume' ? 2 : 1)
            for (const args of spawns) assert.ok(args.includes(codexConfigOverrideArgs(expected)[1]))
            const threadRequest = requests.find(({ method }) => ['thread/start', 'thread/resume'].includes(method))
            assert.deepEqual(threadRequest.params.config['skills.config'], expected['skills.config'])
            if (operation !== 'compact') {
                assert.ok(requests.some(({ method }) => method === 'skills/extraRoots/set'))
                const turn = requests.find(({ method }) => method === 'turn/start')
                assert.deepEqual(turn.params.input.filter((item) => item.type === 'skill'), refs.map(({ name, path }) => ({ type: 'skill', name, path })))
            }
        })
    }
}

test('OpenCode Go sessions keep separate headers across new turns, resume and compaction', async (t) => {
    const { runtime, spawns, requests } = runtimeFixture('general', false, 'https://opencode.ai/inference/go/openai/v1')
    for (const [sessionId, operation] of [['general', 'new'], ['scene_continuation', 'new'], ['general', 'resume'], ['general', 'compact']]) {
        const run = runtime.reserveActiveCodexRun(sessionId)
        t.after(() => runtime.finishActiveCodexRun(run))
        const input = { activeRun: run, sessionId, ownerId: 'owner', novelId: 'novel',
            modelId: 'test-model', codexThreadId: operation === 'new' ? null : 'thread', prompt: 'Write' }
        const spawnStart = spawns.length
        await (operation === 'compact' ? runtime.runNovelCodexCompaction(input) : runtime.runNovelCodexTurn(input))
        const configKey = 'model_providers.opennovelwriter.http_headers'
        const expected = { 'x-opencode-session': sessionId }
        for (const args of spawns.slice(spawnStart)) assert.ok(args.includes(codexConfigOverrideArgs({ [configKey]: expected })[1]))
        const threadRequest = requests.filter(({ method }) => ['thread/start', 'thread/resume'].includes(method)).at(-1)
        assert.deepEqual(threadRequest.params.config[configKey], expected)
        runtime.finishActiveCodexRun(run)
    }
})

test('steering injects only validated references and retains the displayed message', async (t) => {
    const { runtime, service } = runtimeFixture('scene_continuation')
    const run = runtime.reserveActiveCodexRun('steer-scope')
    t.after(() => runtime.finishActiveCodexRun(run))
    const requests = []
    const content = '[Panel writer](skill:continuation) Revise the draft'
    Object.assign(run, { threadId: 'thread', turnId: 'turn',
        client: { request: async (method, params) => { requests.push({ method, params }); return {} } },
        emitEvent: (event) => assert.equal(event.content, content),
    })
    const refs = await service.resolveCodexSessionSkillReferences({ ownerId: 'owner', sessionCategory: 'scene_continuation', content })
    await runtime.steerActiveCodexRun({ sessionId: run.sessionId, message: content, skillRefs: refs })
    assert.equal(requests[0].params.input[0].text, '$Panel writer Revise the draft')
    assert.deepEqual(requests[0].params.input[1], { type: 'skill', name: 'Panel writer', path: '/library/owner/continuation/SKILL.md' })
})
