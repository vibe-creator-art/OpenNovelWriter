const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { createJiti } = require('jiti')
const src = path.resolve(__dirname, '../..')
const jiti = createJiti(__filename, { alias: { '@': src } })

function fixture(composerMode = 'default') {
    const now = new Date()
    let row = { id: 'session', ownerId: 'owner', novelId: 'novel', category: 'general', status: 'idle', composerMode, messagesJson: '[]', draftAttachmentsJson: '[]', draftArtifactsJson: '[]', createdAt: now, updatedAt: now }
    const calls = []
    const mocks = {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/db': { getPrismaClient: () => ({ codexSession: {
            findFirst: async () => row,
            updateMany: async ({ data }) => { row = { ...row, ...data }; return { count: 1 } },
            update: async ({ data }) => { row = { ...row, ...data }; return row },
        } }) },
        '@/lib/server/codex-session-workspace': { getCodexSessionWorkspacePath: () => '/unused' },
        '@/lib/server/codex-app-server': {
            reserveActiveCodexRun: () => ({}), finishActiveCodexRun: () => {}, isCodexRunInterruptedError: () => false,
            runNovelCodexTurn: async (input) => { calls.push(input); return { status: 'completed', threadId: 'thread', assistantText: 'Received.' } },
        },
    }
    const pure = new Set(['@/lib/server/codex-session', '@/lib/server/storage', '@/lib/codex-response-annotations', '@/lib/server/codex-assistant-text', '@/lib/server/codex-live-messages', '@/lib/server/codex-message-projection'])
    const output = ts.transpileModule(fs.readFileSync(path.join(src, 'app/api/codex/sessions/[id]/messages/route.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    new Function('require', 'module', 'exports', output)((name) => Object.hasOwn(mocks, name) ? mocks[name] : pure.has(name) ? jiti(name) : name.startsWith('@/') ? {} : require(name), module, module.exports)
    return { calls, row: () => row, send: (content, attachments, responseAnnotations) => module.exports.POST(new Request('http://localhost/messages', { method: 'POST', body: JSON.stringify({ messageId: 'message', content, attachments, responseAnnotations }) }), { params: Promise.resolve({ id: 'session' }) }) }
}

for (const content of ['', 'Use the red marks.']) {
    test(`markup image is sent with ${content ? 'the draft' : 'no invented prompt'}`, async () => {
        const app = fixture()
        const response = await app.send(content, ['/uploads/markup.png'])
        assert.equal(response.status, 200)
        assert.doesNotMatch(await response.text(), /event: error/)
        assert.equal(app.calls.length, 1)
        assert.equal(app.calls[0].prompt, content)
        assert.deepEqual(app.calls[0].imageUrls, ['/uploads/markup.png'])
        const message = JSON.parse(app.row().messagesJson)[0]
        assert.equal(message.content, content)
        assert.deepEqual(message.attachments, ['/uploads/markup.png'])
    })
}

test('annotation-only messages reach the model and retain their comments and source in history', async () => {
    const annotations = [{ text: 'Selected text', annotation: 'Check this claim.', source: { messageId: 'reply', startOffset: 0, endOffset: 13 } }]
    for (const mode of ['default', 'plan']) {
        const app = fixture(mode)
        const response = await app.send('  ', [], annotations)
        assert.equal(response.status, 200)
        assert.doesNotMatch(await response.text(), /event: error/)
        assert.equal(app.calls.length, 1)
        assert.ok(app.calls[0].prompt.includes(JSON.stringify(annotations)))
        const message = JSON.parse(app.row().messagesJson)[0]
        assert.equal(message.content, '')
        assert.deepEqual(message.responseAnnotations, annotations)
    }
})

test('empty messages require a managed image or annotation; goals still require an objective', async () => {
    for (const [mode, images, annotations] of [['default', []], ['default', ['blob:unsaved']], ['default', [], [{ text: ' ' }]], ['goal', ['/uploads/markup.png']], ['goal', [], [{ text: 'Selected text' }]]]) {
        const app = fixture(mode)
        assert.equal((await app.send('', images, annotations)).status, 400)
        assert.equal(app.calls.length, 0)
        assert.equal(app.row().messagesJson, '[]')
    }
})
