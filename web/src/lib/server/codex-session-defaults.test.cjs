const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { createJiti } = require('jiti')

const src = path.resolve(__dirname, '../..')
const jiti = createJiti(__filename, { alias: { '@': src } })

function createRoute(connection, customFastModeEnabled = false) {
    const file = path.join(src, 'app/api/novels/[id]/codex/sessions/route.ts')
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const mocks = {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/db': { getPrismaClient: () => ({
            novel: { findFirst: async () => ({ id: 'novel', codexSessionAutoCleanup: false, codexCustomFastModeEnabled: customFastModeEnabled }) },
            codexConnection: { findFirst: async () => connection },
            codexSession: { create: async ({ data }) => ({ ...data, id: 'session' }) },
        }) },
    }
    const module = { exports: {} }
    new Function('require', 'module', 'exports', output)((name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        if (name === '@/lib/codex-config' || name === '@/lib/server/codex-session') return jiti(name)
        if (name.startsWith('@/')) return {}
        return require(name)
    }, module, module.exports)
    return module.exports
}

for (const providerType of ['openai-official', 'custom']) {
    for (const category of ['general', 'scene_operation', 'scene_continuation']) {
        test(`${providerType} GPT ${category} session uses the requested model defaults`, async () => {
            const route = createRoute({ id: 'connection', providerType, defaultModelId: 'gpt-5.6-sol' })
            const response = await route.POST(new Request('http://localhost/sessions', {
                method: 'POST', body: JSON.stringify({ category }),
            }), { params: Promise.resolve({ id: 'novel' }) })
            assert.equal(response.status, 201)
            const { session } = await response.json()
            assert.equal(session.modelId, category === 'scene_operation' ? 'gpt-5.6-sol' : 'gpt-6-astra')
            assert.equal(session.reasoningEffort, category === 'scene_operation' ? 'high' : 'medium')
        })
    }
}

for (const category of ['general', 'scene_operation']) {
    test(`non-GPT ${category} session keeps its configured model and effort behavior`, async () => {
        const route = createRoute({ id: 'connection', providerType: 'custom', defaultModelId: 'deepseek-v4-pro' })
        const response = await route.POST(new Request('http://localhost/sessions', {
            method: 'POST', body: JSON.stringify({ category }),
        }), { params: Promise.resolve({ id: 'novel' }) })
        assert.equal(response.status, 201)
        const { session } = await response.json()
        assert.equal(session.modelId, 'deepseek-v4-pro')
        assert.equal(session.reasoningEffort, 'high')
    })
}

test('an explicit model and effort override the new session defaults', async () => {
    const route = createRoute({ id: 'connection', providerType: 'openai-official', authStatus: 'authenticated', authType: 'chatgpt', defaultModelId: null })
    const response = await route.POST(new Request('http://localhost/sessions', {
        method: 'POST', body: JSON.stringify({ modelId: 'gpt-5.6-luna', reasoningEffort: 'max', serviceTier: 'fast' }),
    }), { params: Promise.resolve({ id: 'novel' }) })
    const { session } = await response.json()
    assert.equal(session.modelId, 'gpt-5.6-luna')
    assert.equal(session.reasoningEffort, 'max')
    assert.equal(session.serviceTier, 'fast')
})

for (const customFastModeEnabled of [false, true]) {
    test(`new third-party sessions apply Fast permission ${customFastModeEnabled}`, async () => {
        const route = createRoute({ id: 'connection', providerType: 'custom', authStatus: 'authenticated', authType: 'apiKey' }, customFastModeEnabled)
        const response = await route.POST(new Request('http://localhost/sessions', {
            method: 'POST', body: JSON.stringify({ serviceTier: 'fast' }),
        }), { params: Promise.resolve({ id: 'novel' }) })
        assert.equal(response.status, 201)
        const { session } = await response.json()
        assert.equal(session.serviceTier, customFastModeEnabled ? 'fast' : 'standard')
    })
}
