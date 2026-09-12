const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { NextResponse } = require('next/server')
const { createJiti } = require('jiti')
const jiti = createJiti(__filename, { alias: { '@': path.resolve(__dirname, '../..') } })

test('tool detail endpoint enforces session ownership and serves live or stored results', async () => {
    const { parseCodexSessionMessages } = await jiti.import('./codex-session.ts')
    const file = path.resolve(__dirname, '../../app/api/codex/sessions/[id]/messages/[messageId]/route.ts')
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    let user = null
    let row = null
    let live
    const queries = []
    const modules = {
        'next/server': { NextResponse },
        '@/lib/auth': { getCurrentUser: async () => user },
        '@/lib/db': { getPrismaClient: () => ({ codexSession: { findFirst: async (query) => { queries.push(query); return row } } }) },
        '@/lib/server/codex-live-messages': { getLiveCodexMessages: () => live },
        '@/lib/server/codex-session': { parseCodexSessionMessages },
    }
    const exports = {}
    new Function('require', 'exports', source)((id) => {
        assert.ok(modules[id], `Unexpected dependency ${id}`)
        return modules[id]
    }, exports)
    const get = (messageId = 'tool-1') => exports.GET({}, { params: Promise.resolve({ id: 'session-1', messageId }) })
    assert.equal((await get()).status, 401)
    assert.equal(queries.length, 0)
    user = { userId: 'owner-1' }
    assert.equal((await get()).status, 404)
    assert.deepEqual(queries[0].where, { id: 'session-1', ownerId: 'owner-1' })
    const message = { id: 'tool-1', role: 'event', kind: 'tool', content: 'Read\n\nStored output', createdAt: '2026-09-11T00:00:00.000Z' }
    row = { messagesJson: JSON.stringify([message]) }
    assert.equal((await get('another-session-message')).status, 404)
    assert.equal((await (await get()).json()).message.content, message.content)
    live = [{ ...message, content: 'Read\n\nLive output' }]
    assert.equal((await (await get()).json()).message.content, live[0].content)
})
