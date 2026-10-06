const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { createJiti } = require('jiti')

const src = path.resolve(__dirname, '../..')
const jiti = createJiti(__filename, { alias: { '@': src } })

function load(relativePath, mocks) {
    const code = ts.transpileModule(fs.readFileSync(path.join(src, relativePath), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    new Function('require', 'module', 'exports', code)((name) => mocks[name] ?? (name.startsWith('@/') ? jiti(name) : require(name)), module, module.exports)
    return module.exports
}

for (const [category, file, loader] of [
    ['scene_continuation', 'scene-continuation-menu-data.ts', 'loadSceneContinuationMenuData'],
    ['scene_action', 'scene-operation-menu-data.ts', 'loadSceneOperationMenuData'],
    ['ai_chat', 'ai-chat-menu-data.ts', 'loadAiChatMenuData'],
]) {
    test(`${category}: all category prompts appear in the LLM menu`, async () => {
        const prompts = [{ id: 'first', category }, { id: 'second', category }]
        const defaults = { [category]: { promptId: 'second' } }
        const menu = load(`lib/${file}`, {
            '@/lib/api': {
                promptApi: { list: async (query) => {
                    assert.deepEqual(query, { category })
                    return { prompts }
                } },
                promptDefaultsApi: { get: async () => ({ defaults }) },
                aiApi: { listGroups: async () => ({ groups: [] }) },
            },
        })
        const data = await menu[loader]()
        assert.deepEqual(data.prompts, prompts)
        assert.deepEqual(data.defaults, defaults)
    })
}

test('any prompt in the matching category can be saved and retrieved as the default', async () => {
    const prompt = { id: 'prompt', ownerId: 'owner', category: 'scene_continuation' }
    let saved = []
    const matches = (record, where) => Object.entries(where).every(([key, value]) =>
        typeof value === 'object' && value !== null ? record[key] && matches(record[key], value) : record[key] === value)
    const route = load('app/api/prompt-defaults/route.ts', {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/server/prompt-helpers': { getPromptApiErrorDetail: (error) => error.message },
        '@/lib/db': { prisma: {
            prompt: { findFirst: async ({ where }) => matches(prompt, where) ? prompt : null },
            promptDefault: {
                findMany: async ({ where }) => saved.filter((record) => matches(record, where)),
                upsert: async ({ create }) => { saved = [{ ...create, prompt }] },
            },
        } },
    })
    const response = await route.PUT(new Request('http://localhost/prompt-defaults', {
        method: 'PUT', body: JSON.stringify({ category: prompt.category, promptId: prompt.id }),
    }))
    assert.equal(response.status, 200)
    const expected = { defaults: { scene_continuation: { promptId: 'prompt' } } }
    assert.deepEqual(await response.json(), expected)
    const retrieved = await route.GET(new Request('http://localhost/prompt-defaults'))
    assert.deepEqual(await retrieved.json(), expected)
    const mismatch = await route.PUT(new Request('http://localhost/prompt-defaults', {
        method: 'PUT', body: JSON.stringify({ category: 'ai_chat', promptId: prompt.id }),
    }))
    assert.equal(mismatch.status, 400)
})
