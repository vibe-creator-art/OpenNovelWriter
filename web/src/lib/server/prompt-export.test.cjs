const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')
const { createJiti } = require('jiti')

const src = path.resolve(__dirname, '../..')
const webRoot = path.resolve(src, '..')
const jiti = createJiti(__filename, { alias: { '@': src } })

function loadTs(relativePath, mocks = {}) {
    const code = ts.transpileModule(fs.readFileSync(path.join(src, relativePath), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    new Function('require', 'module', 'exports', code)((name) => mocks[name] ?? (name.startsWith('@/') ? jiti(name) : require(name)), module, module.exports)
    return module.exports
}

function record(id, name, category, content) {
    return {
        id, name, category, ownerId: 'owner', description: `${name} description`,
        messagesJson: JSON.stringify([{ id: `${id}-message`, role: category === 'component' ? 'assistant' : 'user', content }]),
        inputsJson: '[]', modelGroupIdsJson: '["private-model"]', historyJson: '[]',
        agentCallMode: 'generate_then_agent', isNsfw: false,
        sortOrder: 0, sourcePresetId: null, sourcePresetRevision: null,
        createdAt: new Date('2026-09-25T00:00:00Z'), updatedAt: new Date('2026-09-25T01:00:00Z'),
    }
}

function fixture() {
    const records = [
        record('root', '预设-通用续写', 'scene_continuation', '{% include "Style" %}{% include "Shared" %}{{ instruction.text }}'),
        record('style', 'Style', 'component', '{% include "shared" %}STYLE'),
        record('shared', 'Shared', 'component', 'SHARED'),
        record('other', 'Other', 'ai_chat', '{% include "Style" %}{{ chat.userInput }}'),
    ]
    const queries = []
    let builtinReads = 0
    let builtinDescription
    const presets = loadTs('presets/index.ts', {
        'server-only': {},
        'node:fs': {
            ...fs,
            readFileSync(file, ...args) {
                builtinReads++
                const text = fs.readFileSync(file, ...args)
                if (!builtinDescription) return text
                const preset = JSON.parse(text)
                preset.metadata.description = builtinDescription
                return JSON.stringify(preset)
            },
        },
    })
    const service = loadTs('lib/server/prompt-authoring.ts', {
        '@/lib/db': { prisma: {
            prompt: { findMany: async (query) => { queries.push(query); return records } },
            promptDefault: { findMany: async (query) => { queries.push(query); return [{ category: 'scene_continuation', promptId: 'root' }] } },
        } },
        '@/presets': presets,
    })
    const route = loadTs('app/api/internal/codex/prompt-export/route.ts', {
        '@/lib/server/prompt-authoring': service,
        '@/lib/server/codex-internal-auth': { isValidCodexInternalToken: (token) => token === 'internal-token' },
    })
    return {
        records, queries, route,
        export: (options = {}) => service.buildPromptExport({ ownerId: 'owner', ...options }),
        builtinReads: () => builtinReads,
        changeBuiltinDescription: (value) => { builtinDescription = value },
    }
}

test('default export contains only the owner library, descriptions and edit identifiers', async () => {
    const f = fixture()
    const result = await f.export()
    assert.equal(result.ok, true)
    const { manifest, prompts, examples } = result.data
    assert.equal(manifest.source, 'library')
    assert.equal(manifest.entry, null)
    assert.equal(prompts.length, 4)
    assert.deepEqual(examples, [])
    assert.deepEqual(manifest.examples, [])
    assert.equal(f.builtinReads(), 0)
    for (const query of f.queries) assert.deepEqual(query.where, { ownerId: 'owner' })
    assert.equal(manifest.prompts[0].description, f.records[0].description)
    assert.equal(prompts[0].id, 'root')
    assert.equal(prompts[0].updatedAt, '2026-09-25T01:00:00.000Z')
    assert.equal('boundSkills' in manifest.prompts[0], false)
    assert.deepEqual(manifest.prompts[0].defaultFor, ['scene_continuation'])
    assert.equal('modelGroupIds' in prompts[0], false)
    assert.equal('history' in prompts[0], false)
})

test('named export follows nested includes once and reports reverse usages outside the exported files', async () => {
    const f = fixture()
    const { data } = await f.export({ name: '  预设-通用续写  ' })
    assert.deepEqual(data.prompts.map((prompt) => prompt.id), ['root', 'style', 'shared'])
    assert.deepEqual(data.manifest.entry, { name: '预设-通用续写', fileName: 'prompts/root.json' })
    assert.deepEqual(data.manifest.prompts.find((prompt) => prompt.id === 'style').includedBy, ['预设-通用续写', 'Other'])
    assert.deepEqual(data.manifest.prompts.find((prompt) => prompt.id === 'shared').includedBy, ['预设-通用续写', 'Style'])
    assert.equal(f.builtinReads(), 0)
})

test('components can be exported directly by case-insensitive exact name', async () => {
    const { data } = await fixture().export({ name: ' stYLE ' })
    assert.deepEqual(data.prompts.map((prompt) => prompt.id), ['style', 'shared'])
    assert.deepEqual(data.manifest.entry, { name: 'Style', fileName: 'prompts/style.json' })
})

test('builtin export reads the current asset packages without reading the user library', async () => {
    const f = fixture()
    const { data } = await f.export({ source: 'builtin' })
    const assetCount = fs.readdirSync(path.join(src, 'presets/assets')).filter((name) => name.endsWith('.json')).length
    assert.equal(data.examples.length, assetCount)
    assert.deepEqual(data.prompts, [])
    assert.deepEqual(f.queries, [])
    assert.equal(f.builtinReads(), assetCount)
    const descriptions = new Map()
    for (const example of data.examples) {
        const index = data.manifest.examples.find((entry) => entry.presetId === example.preset.metadata.presetId)
        assert.equal(index.category, example.preset.bundle.prompts[0].category)
        assert.equal(index.description, example.preset.metadata.description)
        assert.equal('revision' in index, false)
        assert.ok(example.preset.metadata.revision > 0)
        for (const prompt of example.preset.bundle.prompts) {
            assert.ok(prompt.description?.trim(), prompt.name)
            if (descriptions.has(prompt.name)) assert.equal(prompt.description, descriptions.get(prompt.name))
            descriptions.set(prompt.name, prompt.description)
        }
    }
    f.changeBuiltinDescription('Updated asset description')
    const fresh = await f.export({ source: 'builtin', name: '  预设-通用续写  ' })
    assert.equal(fresh.data.examples.length, 1)
    assert.equal(fresh.data.examples[0].preset.metadata.description, 'Updated asset description')
    assert.equal(fresh.data.manifest.entry.fileName, `examples/${fresh.data.examples[0].fileName}`)
    assert.ok(fresh.data.examples[0].preset.bundle.prompts.some((prompt) => prompt.name === 'CommonAIMistakes'))
    assert.equal(f.builtinReads(), assetCount * 2)
    assert.deepEqual(f.queries, [])
})

test('missing names do not use fuzzy matching or fall back to the other source', async () => {
    const f = fixture()
    for (const options of [
        { name: '预设-通用聊天' },
        { name: '预设-通用续' },
        { name: 'Style', source: 'builtin' },
    ]) {
        const result = await f.export(options)
        assert.equal(result.ok, false)
        assert.equal(result.status, 404)
        assert.ok(result.detail.includes(options.name))
    }
})

test('the export endpoint authorizes requests and validates selector types', async () => {
    const f = fixture()
    const call = (body, token = 'internal-token') => f.route.POST(new Request('http://localhost/prompt-export', {
        method: 'POST', headers: { 'x-onw-internal-token': token }, body: JSON.stringify(body),
    }))
    assert.equal((await call({ ownerId: 'owner' }, 'wrong-token')).status, 403)
    for (const body of [{}, { ownerId: 'owner', source: 'all' }, { ownerId: 'owner', source: null }, { ownerId: 'owner', name: [] }, { ownerId: 'owner', name: '  ' }]) {
        assert.equal((await call(body)).status, 400)
    }
    assert.equal(f.queries.length, 0)
    assert.equal((await call({ ownerId: 'owner', name: 'missing' })).status, 404)
    const response = await call({ ownerId: 'owner', source: 'builtin', name: '预设-通用聊天' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.examples.length, 1)
})

function loadMcpServer(dataDir) {
    const script = path.join(webRoot, 'scripts/opennovelwriter-mcp-server.cjs')
    const scriptRequire = createRequire(script)
    const code = fs.readFileSync(script, 'utf8').replace(/^#![^\n]*\n/, '')
    const process = {
        env: { OPENNOVELWRITER_OWNER_ID: 'owner', OPENNOVELWRITER_INTERNAL_TOKEN: 'internal-token', OPENNOVELWRITER_DATA_DIR: dataDir },
        stdin: { setEncoding() {}, on() {} }, on() {},
    }
    const prisma = { codexSession: { findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: 'session', ownerId: 'owner' })
        return { id: 'session' }
    } } }
    return new Function('require', 'process', '__dirname', `${code}\nreturn { handleRequest };`)((name) => {
        if (name === 'dotenv') return { config() {} }
        if (name === '../generated/prisma/client.js') return { PrismaClient: class { constructor() { return prisma } } }
        if (name === '../src/lib/server/prisma-sqlite.cjs') return { createPrismaSqliteAdapter() {} }
        return scriptRequire(name)
    }, process, path.dirname(script))
}

test('MCP export writes the selected definitions into artifacts and returns only paths and metadata', async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onw-prompt-export-'))
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    const artifacts = path.join(dataDir, 'codex/sessions/owner/session/artifacts')
    fs.mkdirSync(artifacts, { recursive: true })
    const f = fixture()
    const server = loadMcpServer(dataDir)
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url, 'http://127.0.0.1:3000/api/internal/codex/prompt-export')
        return f.route.POST(new Request(url, init))
    })
    const tools = (await server.handleRequest({ method: 'tools/list' })).tools
    assert.equal(tools.some((tool) => tool.name === 'export_prompt_library'), false)
    assert.deepEqual(tools.find((tool) => tool.name === 'export_prompt').inputSchema.required, ['directoryPath'])
    const call = (args) => server.handleRequest({ method: 'tools/call', params: { name: 'export_prompt', arguments: args } })
    for (const [index, options] of [{}, { name: '预设-通用续写' }, { source: 'builtin' }, { source: 'builtin', name: '预设-通用聊天' }].entries()) {
        const directoryPath = path.join(artifacts, `export-${index}`)
        const result = await call({ directoryPath, ...options })
        assert.notEqual(result.isError, true, result.content[0]?.text)
        const payload = JSON.parse(result.content[0].text)
        const manifest = JSON.parse(fs.readFileSync(payload.manifestPath, 'utf8'))
        assert.equal(manifest.source, options.source ?? 'library')
        assert.equal(payload.entryPath, manifest.entry ? path.join(payload.directoryPath, manifest.entry.fileName) : null)
        for (const entry of [...manifest.prompts, ...manifest.examples]) {
            const exported = JSON.parse(fs.readFileSync(path.join(directoryPath, entry.fileName), 'utf8'))
            assert.equal(exported.name ?? exported.metadata.name, entry.name)
        }
        assert.equal(fs.existsSync(path.join(directoryPath, 'examples')), options.source === 'builtin')
        assert.equal(fs.existsSync(path.join(directoryPath, 'prompts')), options.source !== 'builtin')
        assert.equal('prompts' in payload, false)
        assert.equal('examples' in payload, false)
    }
    const missingPath = path.join(artifacts, 'missing')
    assert.equal((await call({ directoryPath: missingPath, name: 'missing' })).isError, true)
    assert.equal(fs.existsSync(missingPath), false)
})

test('exported component inputs round-trip through MCP composition with option IDs, checkboxes and deduplicated selections', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onw-export-compose-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const artifacts = path.join(directory, 'codex/sessions/owner/session/artifacts')
    fs.mkdirSync(artifacts, { recursive: true })
    const { createPromptInput, createPromptCheckboxInput, createPromptContentSelectionInput } = jiti('@/lib/prompt-inputs')
    const custom = createPromptInput(); custom.name = 'Tone'
    custom.custom.dropdown.enabled = true
    custom.custom.dropdown.options = [{ id: 'option-id', label: 'Visible name', content: 'Actual writing requirements.', description: null, color: null }]
    custom.custom.defaultContent = { dropdownOptionIds: ['option-id'], text: '' }
    const checkbox = createPromptCheckboxInput(); checkbox.name = 'Planning'; checkbox.checkbox.defaultChecked = true
    checkbox.checkbox.displayName = 'Make a plan.'
    const selection = createPromptContentSelectionInput(); selection.name = 'References'
    const f = fixture()
    f.records[0].messagesJson = JSON.stringify([{ id: 'message', role: 'user', content: '{% include "Style" %}' }])
    f.records[1].inputsJson = JSON.stringify([custom, checkbox, selection])
    f.records[1].messagesJson = JSON.stringify([{ id: 'component-message', role: 'assistant', content: '{{ inputs["Tone"].value }}\n{{ inputs["Planning"].value }}\n{{ inputs["References"].value }}' }])
    const composition = loadTs('lib/server/continuation-compose.ts', { '@/lib/db': { prisma: {
        prompt: { findMany: async () => f.records },
        scene: { findFirst: async () => ({ id: 'scene', chapterId: 'chapter', content: '', chapter: { id: 'chapter', actNumber: 1 } }) },
        novel: { findFirst: async () => ({ language: 'en', acts: [], chapters: [], labels: [] }) },
        novelTermState: { findUnique: async () => null },
        outline: { findMany: async () => [] },
        snippet: { findMany: async () => [{ id: 'snippet', title: 'Note', content: '<p>REFERENCE CONTENT</p>' }] },
        aiModelGroup: { findMany: async () => [] },
    } } })
    const route = loadTs('app/api/internal/codex/compose-continuation/route.ts', {
        '@/lib/server/continuation-compose': composition,
        '@/lib/server/codex-internal-auth': { isValidCodexInternalToken: (token) => token === 'internal-token' },
    })
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        if (url.endsWith('/prompt-export')) return f.route.POST(new Request(url, init))
        assert.ok(url.endsWith('/compose-continuation'))
        return route.POST(new Request(url, init))
    })
    const server = loadMcpServer(directory)
    const call = (name, args) => server.handleRequest({ method: 'tools/call', params: { name, arguments: args } })
    const exported = await call('export_prompt', { directoryPath: path.join(artifacts, 'export'), name: '预设-通用续写' })
    assert.notEqual(exported.isError, true, exported.content[0]?.text)
    const definition = JSON.parse(fs.readFileSync(JSON.parse(exported.content[0].text).entryPath, 'utf8'))
    assert.deepEqual(definition.inputs, [])
    const component = JSON.parse(fs.readFileSync(path.join(artifacts, 'export/prompts/style.json'), 'utf8'))
    assert.deepEqual(component.inputs[0].custom, custom.custom)
    const [option] = component.inputs[0].custom.dropdown.options
    const mdPath = path.join(artifacts, 'continuation.md')
    const args = { promptName: definition.name, novelId: 'novel', sceneId: 'scene', instruction: 'Continue', mdPath }
    const defaults = await call('compose_scene_continuation', args)
    assert.notEqual(defaults.isError, true, defaults.content[0]?.text)
    assert.equal(fs.readFileSync(mdPath, 'utf8'), '## user\n\nActual writing requirements.\nMake a plan.\n')
    const result = await call('compose_scene_continuation', { ...args, inputs: {
        custom: { Tone: { dropdownOptionIds: [option.id], text: 'Author requirement.' } },
        checkbox: { Planning: false },
        contentSelection: { References: [{ kind: 'snippet', snippetId: 'snippet' }, { kind: 'snippet', snippetId: 'snippet' }] },
    } })
    assert.notEqual(result.isError, true, result.content[0]?.text)
    const text = fs.readFileSync(mdPath, 'utf8')
    assert.match(text, /Actual writing requirements\.\n\nAuthor requirement\./)
    assert.equal(text.match(/REFERENCE CONTENT/g).length, 1)
    assert.doesNotMatch(text, /Visible name|Make a plan\./)
})
