const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')
const { test } = require('node:test')
const Database = require('better-sqlite3')
const { createJiti } = require('jiti')

const jiti = createJiti(__filename)
const codexAvailable = spawnSync('codex', ['--version'], { shell: process.platform === 'win32' }).status === 0

async function openCodex(home) {
    const child = spawn('codex', ['app-server'], {
        env: { ...process.env, CODEX_HOME: home },
        stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32',
    })
    let id = 0
    const pending = new Map()
    child.stderr.resume()
    const lines = readline.createInterface({ input: child.stdout })
    lines.on('line', (line) => {
        const message = JSON.parse(line)
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id)
        clearTimeout(request.timer)
        if (message.error) request.reject(new Error(message.error.message))
        else request.resolve(message.result)
    })
    child.on('exit', () => {
        for (const request of pending.values()) {
            clearTimeout(request.timer)
            request.reject(new Error('Codex exited'))
        }
        pending.clear()
    })
    const client = {
        request(method, params) {
            return new Promise((resolve, reject) => {
                const requestId = ++id
                const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method}`)) }, 15000)
                pending.set(requestId, { resolve, reject, timer })
                child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n')
            })
        },
        async close() {
            if (child.exitCode !== null || child.signalCode !== null) return
            const exited = new Promise((resolve) => child.once('exit', resolve))
            child.kill('SIGTERM')
            await exited
            lines.close()
        },
    }
    try {
        await client.request('initialize', { clientInfo: { name: 'onw_transfer_test', version: '1' }, capabilities: { experimentalApi: true } })
        return client
    } catch (error) {
        await client.close()
        throw error
    }
}

async function createHome(root, name) {
    const home = path.join(root, name)
    await fs.mkdir(home)
    await fs.writeFile(path.join(home, 'config.toml'), [
        `model_provider="${name}"`, 'model="gpt-5.4"', `[model_providers.${name}]`,
        `name="${name}"`, 'base_url="http://127.0.0.1:9/v1"', 'wire_api="responses"', 'requires_openai_auth=false',
    ].join('\n'))
    return home
}

async function writeHistory(home, workspace, id, text) {
    const timestamp = '2026-09-07T00:00:00.000Z'
    const turnId = randomUUID()
    const rows = [
        ['session_meta', { id, timestamp, cwd: workspace, originator: 'codex_cli_rs', cli_version: '0.153.4', source: 'cli', model_provider: 'source' }],
        ['event_msg', { type: 'task_started', turn_id: turnId, model_context_window: 258400, collaboration_mode_kind: 'default' }],
        ['response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }],
        ['event_msg', { type: 'user_message', message: text, images: [], local_images: [], text_elements: [] }],
        ['response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Answer: ${text}` }] }],
        ['event_msg', { type: 'agent_message', message: `Answer: ${text}`, phase: 'final_answer' }],
        ['event_msg', { type: 'task_complete', turn_id: turnId, last_agent_message: `Answer: ${text}` }],
    ]
    const relative = path.join('sessions', '2026', '09', '07', `rollout-2026-09-07T00-00-00-${id}.jsonl`)
    const file = path.join(home, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, rows.map(([type, payload]) => JSON.stringify({ timestamp, type, payload })).join('\n') + '\n')
    return relative
}

test('connection transfer preserves native history, descendants and goal accounting', { skip: !codexAvailable, timeout: 60000 }, async (t) => {
    const { transferCodexConnectionThreads } = await jiti.import('./codex-connection-transfer.ts')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-transfer-test-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const source = await createHome(root, 'source')
    const target = await createHome(root, 'target')
    const workspace = path.join(root, 'workspace')
    await fs.mkdir(workspace)
    const threadId = randomUUID(), childId = randomUUID(), existingId = randomUUID()
    const relative = await writeHistory(source, workspace, threadId, 'Full root context')
    await writeHistory(source, workspace, childId, 'Child context')
    await writeHistory(target, workspace, existingId, 'Existing destination context')
    await fs.writeFile(path.join(source, 'auth.json'), '{}')
    const resume = (client, id) => client.request('thread/resume', { threadId: id, cwd: workspace, model: 'gpt-5.4', excludeTurns: false })
    const original = await openCodex(source)
    try {
        await resume(original, threadId)
        await resume(original, childId)
        await original.request('thread/goal/set', { threadId, objective: 'Keep writing', status: 'paused', tokenBudget: 10000 })
    } finally { await original.close() }
    const destination = await openCodex(target)
    try { await resume(destination, existingId) } finally { await destination.close() }

    const state = new Database(path.join(source, 'state_5.sqlite'))
    state.prepare('INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status) VALUES (?, ?, ?)').run(threadId, childId, 'completed')
    state.close()
    const goals = new Database(path.join(source, 'goals_1.sqlite'))
    goals.prepare('UPDATE thread_goals SET tokens_used = 321, time_used_seconds = 45 WHERE thread_id = ?').run(threadId)
    const expectedGoal = goals.prepare('SELECT * FROM thread_goals WHERE thread_id = ?').get(threadId)
    goals.close()
    const expectedHistory = await fs.readFile(path.join(source, relative))
    const targetConfig = await fs.readFile(path.join(target, 'config.toml'))

    await transferCodexConnectionThreads(source, target, [threadId])
    assert.deepEqual(await fs.readFile(path.join(target, relative)), expectedHistory)
    assert.deepEqual(await fs.readFile(path.join(target, 'config.toml')), targetConfig)
    await assert.rejects(fs.stat(path.join(target, 'auth.json')), { code: 'ENOENT' })
    const transferredGoals = new Database(path.join(target, 'goals_1.sqlite'))
    assert.deepEqual(transferredGoals.prepare('SELECT * FROM thread_goals WHERE thread_id = ?').get(threadId), expectedGoal)
    transferredGoals.close()
    await fs.rm(source, { recursive: true })

    const rebound = await openCodex(target)
    try {
        const result = await resume(rebound, threadId)
        assert.equal(result.thread.id, threadId)
        assert.equal(result.modelProvider, 'target')
        assert.match(JSON.stringify(result.thread.turns), /Full root context/)
        assert.match(JSON.stringify(result.thread.turns), /Answer: Full root context/)
        const { goal } = await rebound.request('thread/goal/get', { threadId })
        assert.equal(goal.objective, 'Keep writing')
        assert.equal(goal.status, 'paused')
        assert.equal(goal.tokenBudget, 10000)
        assert.equal(goal.tokensUsed, 321)
        assert.equal(goal.timeUsedSeconds, 45)
        assert.match(JSON.stringify((await resume(rebound, childId)).thread.turns), /Child context/)
        assert.match(JSON.stringify((await resume(rebound, existingId)).thread.turns), /Existing destination context/)
    } finally { await rebound.close() }
})
