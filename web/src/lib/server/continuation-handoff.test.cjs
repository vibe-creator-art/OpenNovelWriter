const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { createJiti } = require('jiti')
const src = path.resolve(__dirname, '../..')
const jiti = createJiti(__filename, { alias: { '@': src } })
function load(relative, mocks = {}, emptyServerImports = false) {
    const output = ts.transpileModule(fs.readFileSync(path.join(src, relative), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    new Function('require', 'module', 'exports', output)((name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        if (emptyServerImports && name.startsWith('@/lib/server/') && name !== '@/lib/server/codex-session') return {}
        return name.startsWith('@/') ? jiti(name) : require(name)
    }, module, module.exports)
    return module.exports
}
const { createPromptContentSelectionInput, createPromptInput, createPromptCheckboxInput, renderPromptCustomInputValue, deduplicateContentSelections } = jiti('@/lib/prompt-inputs')
const { parseContinuationInputs } = jiti('@/lib/continuation-inputs')
const { continuationInputsFromValues } = jiti('@/lib/continuation-prompt')
const { parseLlmConversation } = require('./llm-conversation.cjs')
const { searchContent } = require('./content-search.cjs')
function fixture() {
    const input = createPromptContentSelectionInput()
    input.name = '资料'; input.required = true
    const custom = createPromptInput(); custom.name = '字数'; custom.required = true
    const term = { id: 'term', title: '云依', categoryId: 'characters', description: 'KNOWLEDGE', aliases: '', tags: ['main'], archived: false }
    const scene = { id: 'scene', content: '<p>BEFORE</p><p>AFTER</p>', order: 0, summary: 'SUMMARY', labelIdsJson: '["label"]', chapterId: 'chapter', chapter: { id: 'chapter', actNumber: 1 } }
    const novel = { language: 'zh-CN', termContextIncludesRelations: false, termContextIncludesExperiences: false,
        labels: [{ id: 'label' }], acts: [{ number: 1, title: 'ACT', summary: 'ACTSUMMARY', labelIdsJson: '["label"]' }],
        chapters: [{ id: 'chapter', title: 'CHAPTER', actNumber: 1, order: 0, scenes: [scene] }],
    }
    const template = `{% set selected = inputs["资料"].term | union(inputs["资料"].termTag) | union(termsfrom(scene.chapterOutline, inputs["资料"].snippet)) %}{{ selected.value }}\n{{ inputs["资料"].fullNovel.value }}\n{{ inputs["资料"].act.value }}\n{{ inputs["资料"].chapter.value }}\n{{ inputs["资料"].scene.value }}\n{{ inputs["资料"].actOutline.value }}\n{{ inputs["资料"].chapterOutline.value }}\n{{ inputs["资料"].snippet.value }}\n{{ scene.chapterOutline }}\n{{ scene.actOutline }}\n{{ scene.continue.previousText }}|{{ scene.continue.followText }}\n{{ inputs["字数"].value }}`
    const prompt = { id: 'p', name: 'Writer', category: 'scene_continuation', inputs: [input, custom], messages: [{ role: 'user', content: template }], modelGroupIds: ['g2', 'g1'] }
    const queries = []
    const db = {
        prompt: { findMany: async () => [prompt] },
        scene: { findFirst: async (query) => { queries.push(query); return scene } },
        novel: { findFirst: async (query) => { queries.push(query); return novel } },
        novelTermState: { findUnique: async () => ({ stateJson: JSON.stringify({ entries: [term] }) }) },
        outline: { findMany: async () => [{ type: 'CHAPTER', chapterId: 'chapter', content: '<p>云依 CHAPTEROUTLINE</p>' }, { type: 'ACT', actNumber: 1, content: '<p>ACTOUTLINE</p>' }] },
        snippet: { findMany: async () => [{ id: 'snippet', title: 'SNIPPET', content: '<p>云依 NOTE</p>' }] },
        aiModelGroup: { findMany: async () => [{ id: 'g1', name: 'First' }, { id: 'g2', name: 'Second' }] },
    }
    const service = load('lib/server/continuation-compose.ts', { '@/lib/db': { prisma: db }, '@/lib/server/prompt-helpers': { toPromptDto: (value) => value } })
    const compose = (inputs = {}) => service.composeSceneContinuation({ ownerId: 'owner', novelId: 'novel', sceneId: 'scene', promptName: 'Writer', instruction: 'Write', afterParagraph: 'BEFORE', inputs })
    return { compose, prompt, input, db, queries, service }
}

test('virtual continuation expands every selection kind and extracts outline/snippet terms once', async () => {
    const f = fixture()
    const selections = [{ kind: 'full_novel' }, { kind: 'act', actNumber: 1 }, { kind: 'chapter', chapterId: 'chapter' }, { kind: 'scene', sceneId: 'scene' }, { kind: 'act_outline', actNumber: 1 }, { kind: 'chapter_outline', chapterId: 'chapter' }, { kind: 'snippet', snippetId: 'snippet' }, { kind: 'term', termId: 'term' }, { kind: 'label', labelId: 'label' }, { kind: 'term_tag', tag: 'main' }]
    const result = await f.compose(parseContinuationInputs({ custom: { 字数: { text: '2000' } }, contentSelection: { 资料: selections } }))
    assert.equal(result.ok, true)
    assert.deepEqual(result.result.missingInputs, [])
    assert.deepEqual(result.result.groups.map((item) => item.id), ['g2', 'g1'])
    for (const value of ['KNOWLEDGE', 'ACTSUMMARY', 'CHAPTER', 'BEFORE', 'AFTER', 'ACTOUTLINE', 'CHAPTEROUTLINE', 'NOTE', '2000']) assert.ok(result.result.markdown.includes(value), value)
    assert.equal(result.result.markdown.match(/KNOWLEDGE/g).length, 1)
    assert.deepEqual(f.queries[0].where.chapter, { novelId: 'novel', novel: { ownerId: 'owner' } })
})

test('virtual continuation uses the same label/full-summary expansion as the panel', async () => {
    const f = fixture()
    f.input.contentSelection.options.scene.treatAs = 'summary'
    f.prompt.messages = [{ role: 'user', content: '{{ inputs["资料"].scene.value }}' }]
    const result = await f.compose({ contentSelection: { 资料: [{ kind: 'label', labelId: 'label' }, { kind: 'scene', sceneId: 'scene' }] } })
    assert.equal(result.result.markdown.match(/SUMMARY/g).length, 1)
    assert.doesNotMatch(result.result.markdown, /BEFORE|AFTER/)
})

test('content search targets can be passed directly to virtual continuation inputs', async (t) => {
    const f = fixture()
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onw-search-compose-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const base = await f.db.novel.findFirst({})
    const novel = {
        ...base, id: 'novel', title: 'Book',
        acts: base.acts.map((act) => ({ ...act, id: 'act-id' })),
        labels: [{ id: 'label', name: 'Label' }],
        outlines: (await f.db.outline.findMany()).map((outline, index) => ({ ...outline, id: `outline-${index}` })),
        snippets: await f.db.snippet.findMany(),
        termState: await f.db.novelTermState.findUnique(),
    }
    const prisma = { novel: { findFirst: async () => novel } }
    const selections = []
    for (const [kind, query] of [
        ['full_novel', 'Book'], ['act', 'ACT'], ['chapter', 'CHAPTER'], ['scene', 'CHAPTER'],
        ['act_outline', 'ACT'], ['chapter_outline', 'CHAPTER'], ['snippet', 'SNIPPET'],
        ['term', '云依'], ['label', 'Label'], ['term_tag', 'main'],
    ]) {
        const result = await searchContent({ prisma, ownerId: 'owner', workspaceRoot: directory }, { novelId: 'novel', query, kinds: [kind] })
        assert.equal(result.items.length, 1, kind)
        selections.push(result.items[0].target)
    }
    const composed = await f.compose(parseContinuationInputs({ custom: { 字数: { text: '2000' } }, contentSelection: { 资料: selections } }))
    assert.equal(composed.ok, true)
    assert.deepEqual(composed.result.missingInputs, [])
    for (const text of ['KNOWLEDGE', 'ACTSUMMARY', 'CHAPTEROUTLINE', 'ACTOUTLINE', 'NOTE', '2000']) assert.ok(composed.result.markdown.includes(text), text)
})

test('virtual continuation applies inclusion policy to manual, detected and aggregate term output', async () => {
    const f = fixture()
    f.db.novelTermState.findUnique = async () => ({ stateJson: JSON.stringify({ entries: [
        { id: 'term', title: '云依', categoryId: 'characters', aiContextPolicy: 'never', tags: ['main'], description: 'NEVER_KNOWLEDGE' },
        { id: 'always', title: '白帝', categoryId: 'characters', aiContextPolicy: 'always', description: 'ALWAYS_KNOWLEDGE' },
    ] }) })
    for (const expression of ['instruction.terms.value', 'inputs["资料"].term.value', 'inputs["资料"].termTag.value', 'inputs["资料"].value', 'termsfrom(scene.chapterOutline).value', 'termsfrom().value']) {
        f.prompt.messages = [{ role: 'user', content: `{{ ${expression} }}` }]
        const result = await f.compose({ contentSelection: { 资料: [{ kind: 'term', termId: 'term' }, { kind: 'term_tag', tag: 'main' }] } })
        assert.match(result.result.markdown, /ALWAYS_KNOWLEDGE/, expression)
        assert.doesNotMatch(result.result.markdown, /NEVER_KNOWLEDGE/, expression)
    }
    f.prompt.messages = [{ role: 'user', content: '{{ scene.chapterOutline }}' }]
    const plain = await f.compose()
    assert.match(plain.result.markdown, /云依/)
    assert.doesNotMatch(plain.result.markdown, /ALWAYS_KNOWLEDGE|NEVER_KNOWLEDGE/)
})

test('missing inputs are reported before generation; invalid, disabled and foreign references are rejected', async () => {
    const f = fixture()
    assert.deepEqual((await f.compose()).result.missingInputs, ['资料', '字数'])
    assert.equal((await f.compose({ checkbox: { 字数: true } })).ok, false)
    assert.equal((await f.compose({ contentSelection: { 资料: [{ kind: 'scene', sceneId: 'foreign-scene' }] } })).ok, false)
    f.input.contentSelection.options.scene.enabled = false
    assert.equal((await f.compose({ contentSelection: { 资料: [{ kind: 'scene', sceneId: 'scene' }] } })).ok, false)
    assert.throws(() => parseContinuationInputs({ contentSelection: { 资料: [{ kind: 'chapter' }] } }))
    f.prompt.category = 'ai_chat'
    assert.equal((await f.compose()).ok, false)
})

test('required checks ignore unreferenced inputs of every type, including templates with no input references', async () => {
    const f = fixture()
    const checkbox = createPromptCheckboxInput(); checkbox.name = 'Planning'; checkbox.required = true
    f.prompt.inputs.push(checkbox)
    f.prompt.messages = [{ role: 'user', content: '{{ inputs["字数"].value }}' }]
    assert.deepEqual((await f.compose()).result.missingInputs, ['字数'])
    assert.deepEqual((await f.compose({ custom: { 字数: { text: '2000' } } })).result.missingInputs, [])
    f.prompt.messages = [{ role: 'user', content: '{{ scene.text }}' }]
    assert.deepEqual((await f.compose()).result.missingInputs, [])
    f.prompt.messages = []
    assert.deepEqual((await f.compose()).result.missingInputs, [])
})

test('required checks follow nested includes and normalize names without checking unrelated components', async () => {
    const f = fixture()
    const checkbox = createPromptCheckboxInput(); checkbox.name = 'Planning'; checkbox.required = true
    f.prompt.inputs.push(checkbox)
    f.prompt.messages = [{ role: 'user', content: '{%- include "Outer" %}' }]
    const component = (name, content) => ({ id: name, name, category: 'component', inputs: [], messages: [{ role: 'assistant', content }] })
    f.db.prompt.findMany = async () => [
        f.prompt,
        component('Outer', '{%- include "inner" %}'),
        component('Inner', '{{ inputs["字数"].value }}{% if inputs.planning.value %}Plan{% endif %}'),
        component('Unrelated', '{{ inputs["资料"].value }}'),
    ]
    assert.deepEqual((await f.compose()).result.missingInputs, ['字数', 'Planning'])
    assert.deepEqual((await f.compose({ custom: { 字数: { text: '2000' } }, checkbox: { Planning: true } })).result.missingInputs, [])
    f.prompt.messages = [{ role: 'user', content: 'No components.' }]
    assert.deepEqual((await f.compose()).result.missingInputs, [])
})

test('virtual continuation inherits all three input types and defaults from nested components', async () => {
    const f = fixture()
    const custom = f.prompt.inputs[1]
    custom.custom.dropdown.enabled = true
    custom.custom.dropdown.options = [{ id: 'opt', label: 'Label', content: 'WRITING RULE', description: null, color: null }]
    custom.custom.defaultContent = { dropdownOptionIds: ['opt'], text: '' }
    const checkbox = createPromptCheckboxInput(); checkbox.name = '测试'; checkbox.required = true
    checkbox.checkbox = { defaultChecked: true, displayName: 'ENABLED' }
    const unused = createPromptInput(); unused.name = 'Unused'; unused.required = true
    const component = (name, inputs, content) => ({ id: name, name, category: 'component', inputs, messages: [{ role: 'assistant', content }] })
    f.prompt.inputs = []
    f.prompt.messages = [{ role: 'user', content: '{% include "Outer" %}' }]
    f.db.prompt.findMany = async () => [
        f.prompt,
        component('Outer', [checkbox, unused], '{{ inputs["测试"].value }}{% include "Inner" %}'),
        component('Inner', [f.input, custom], '{{ inputs["字数"].value }}\n{{ inputs["资料"].value }}'),
    ]
    const defaults = await f.compose()
    assert.equal(defaults.ok, true)
    assert.match(defaults.result.markdown, /ENABLED/)
    assert.match(defaults.result.markdown, /WRITING RULE/)
    assert.deepEqual(defaults.result.missingInputs, ['资料'])
    const result = await f.compose(parseContinuationInputs({
        custom: { 字数: { text: 'AUTHOR TEXT' } },
        checkbox: { 测试: false },
        contentSelection: { 资料: [{ kind: 'snippet', snippetId: 'snippet' }] },
    }))
    assert.equal(result.ok, true)
    assert.match(result.result.markdown, /AUTHOR TEXT/)
    assert.match(result.result.markdown, /云依 NOTE/)
    assert.doesNotMatch(result.result.markdown, /ENABLED|WRITING RULE/)
    assert.deepEqual(result.result.missingInputs, ['测试'])
    const byId = await f.compose({ custom: { 字数: { dropdownOptionIds: ['opt'] } }, checkbox: { 测试: true } })
    assert.match(byId.result.markdown, /WRITING RULE/)
    assert.equal((await f.compose({ custom: { 字数: { dropdownOptionIds: ['missing'] } } })).ok, false)
    assert.equal((await f.compose({ checkbox: { 字数: true } })).ok, false)
    f.input.contentSelection.options.snippet.enabled = false
    assert.equal((await f.compose({ contentSelection: { 资料: [{ kind: 'snippet', snippetId: 'snippet' }] } })).ok, false)
})

test('input conflicts use root definitions first, then the first recursively included component', async () => {
    const f = fixture()
    const root = createPromptCheckboxInput(); root.name = 'Choice'
    root.checkbox = { defaultChecked: true, displayName: 'ROOT' }
    const choice = (text) => {
        const input = createPromptInput(); input.name = ' choice '; input.required = true
        input.custom.defaultContent.text = text
        return input
    }
    const component = (name, inputs, content) => ({ id: name, name, category: 'component', inputs, messages: [{ role: 'assistant', content }] })
    const outer = component('Outer', [], '{% include "Inner" %}')
    const inner = component('Inner', [choice('INNER')], '{{ inputs.Choice.value }}')
    const later = component('Later', [choice('LATER')], '{{ inputs.Choice.value }}')
    const unrelated = component('Unrelated', [choice('UNRELATED')], '{{ inputs.Choice.value }}')
    f.prompt.inputs = [root]
    f.prompt.messages = [{ role: 'user', content: '{% include "Outer" %}|{% include "Later" %}' }]
    f.db.prompt.findMany = async () => [unrelated, later, f.prompt, inner, outer]
    assert.equal((await f.compose()).result.markdown, '## user\n\nROOT|ROOT\n')
    assert.equal((await f.compose({ custom: { Choice: { text: 'Wrong type' } } })).ok, false)
    f.prompt.inputs = []
    assert.equal((await f.compose()).result.markdown, '## user\n\nINNER|INNER\n')
    const empty = await f.compose({ custom: { CHOICE: {} } })
    assert.equal(empty.result.missingInputs.length, 1)
    f.prompt.messages = [{ role: 'user', content: '{% include "Later" %}|{% include "Outer" %}' }]
    assert.equal((await f.compose()).result.markdown, '## user\n\nLATER|LATER\n')
    f.prompt.messages = [{ role: 'user', content: 'No include' }]
    assert.equal((await f.compose({ custom: { Choice: { text: 'Unknown' } } })).ok, false)
})

test('content selections deduplicate every target kind without merging different kinds or changing order', () => {
    const targets = [
        { kind: 'full_novel' }, { kind: 'act', actNumber: 1 }, { kind: 'act_outline', actNumber: 1 },
        { kind: 'chapter', chapterId: 'same-id' }, { kind: 'chapter_outline', chapterId: 'same-id' },
        { kind: 'scene', sceneId: 'same-id' }, { kind: 'snippet', snippetId: 'same-id' },
        { kind: 'term', termId: 'same-id' }, { kind: 'label', labelId: 'same-id' }, { kind: 'term_tag', tag: 'same-id' },
    ]
    const repeated = [...targets, ...targets.map((target) => Object.fromEntries(Object.entries(target).reverse()))]
    assert.deepEqual(deduplicateContentSelections(repeated), targets)
    assert.equal(repeated.length, 20)
})

test('content selection deduplication precedes single-select validation and does not cross inputs', async () => {
    const f = fixture()
    const second = createPromptContentSelectionInput(); second.name = 'Other'
    f.prompt.inputs = [f.input, second]
    f.input.contentSelection.allowMultiple = false
    f.prompt.messages = [{ role: 'user', content: '{{ inputs["资料"].value }}\n{{ inputs["Other"].value }}' }]
    const snippet = { kind: 'snippet', snippetId: 'snippet' }
    const duplicate = [snippet, { snippetId: 'snippet', kind: 'snippet' }]
    const result = await f.compose(parseContinuationInputs({ contentSelection: { 资料: duplicate } }))
    assert.equal(result.ok, true)
    assert.deepEqual(result.result.missingInputs, [])
    assert.equal(result.result.markdown.match(/NOTE/g).length, 1)
    const acrossInputs = await f.compose({ contentSelection: { 资料: duplicate, Other: duplicate } })
    assert.equal(acrossInputs.result.markdown.match(/NOTE/g).length, 2)
    assert.equal((await f.compose({ contentSelection: { 资料: [...duplicate, { kind: 'scene', sceneId: 'scene' }] } })).ok, false)
    f.input.contentSelection.options.snippet.enabled = false
    assert.equal((await f.compose({ contentSelection: { 资料: duplicate } })).ok, false)
})

function customFixture() {
    const f = fixture()
    const custom = f.prompt.inputs[1]
    custom.custom.dropdown.enabled = true
    custom.custom.dropdown.options = [
        { id: 'short', label: 'Short', content: ' Write 1000 words. ', description: null, color: null },
        { id: 'fallback', label: ' Use dialogue. ', content: ' ', description: null, color: null },
    ]
    custom.custom.defaultContent = { dropdownOptionIds: ['short'], text: 'DEFAULT TEXT' }
    f.prompt.inputs = [custom]
    f.prompt.messages = [{ role: 'user', content: '{{ inputs["字数"].value }}' }]
    return { ...f, custom }
}

test('option IDs expand to content with label fallback, preserving panel selection order and free text', async () => {
    const f = customFixture()
    const state = { dropdownOptionIds: ['fallback', 'short'], text: '  Add a closing line.  ' }
    const result = await f.compose(parseContinuationInputs({ custom: { 字数: state } }))
    assert.equal(result.ok, true)
    assert.deepEqual(result.result.missingInputs, [])
    assert.equal(result.result.markdown, '## user\n\nUse dialogue.\n\nWrite 1000 words.\n\nAdd a closing line.\n')
    assert.equal(result.result.markdown, `## user\n\n${renderPromptCustomInputValue(f.custom, state)}\n`)
    assert.doesNotMatch(result.result.markdown, /DEFAULT TEXT|Short/)
})

test('omitting a custom input uses its default, while supplied fields replace it and an empty object clears it', async () => {
    const f = customFixture()
    assert.equal((await f.compose()).result.markdown, '## user\n\nWrite 1000 words.\n\nDEFAULT TEXT\n')
    for (const [value, expected] of [
        [{ text: '2500' }, '2500'],
        [{ dropdownOptionIds: ['fallback'] }, 'Use dialogue.'],
        [{}, ''],
        [{ dropdownOptionIds: [], text: '' }, ''],
    ]) {
        const result = await f.compose(parseContinuationInputs({ custom: { 字数: value } }))
        assert.equal(result.result.markdown, expected ? `## user\n\n${expected}\n` : '\n')
        assert.deepEqual(result.result.missingInputs, expected ? [] : ['字数'])
    }
})

test('custom inputs enforce enabled modes, valid unique IDs, and the panel single-select OR rule', async () => {
    const f = customFixture()
    for (const dropdownOptionIds of [['Short'], ['Write 1000 words.'], ['missing'], ['short', 'short']]) {
        assert.equal((await f.compose({ custom: { 字数: { dropdownOptionIds } } })).ok, false)
    }
    f.custom.custom.dropdown.allowMultiple = false
    assert.equal((await f.compose({ custom: { 字数: { dropdownOptionIds: ['short', 'fallback'] } } })).ok, false)
    assert.equal((await f.compose({ custom: { 字数: { dropdownOptionIds: ['short'], text: '2500' } } })).ok, false)
    assert.equal((await f.compose({ custom: { 字数: { dropdownOptionIds: ['short'] } } })).ok, true)
    assert.equal((await f.compose({ custom: { 字数: { text: '2500' } } })).ok, true)
    f.custom.custom.text.enabled = false
    assert.equal((await f.compose({ custom: { 字数: { text: '2500' } } })).ok, false)
    assert.equal((await f.compose({ custom: { 字数: { dropdownOptionIds: ['short'] } } })).ok, true)
    f.custom.custom.dropdown.enabled = false
    assert.equal((await f.compose({ custom: { 字数: { dropdownOptionIds: ['short'] } } })).ok, false)
})

test('the input contract rejects final strings, checkbox strings and unrecognized custom fields', () => {
    for (const inputs of [
        { custom: { 字数: '2000' } },
        { custom: { 字数: { dropdownOptionIds: [''] } } },
        { custom: { 字数: { dropdownOptionIds: 'short' } } },
        { custom: { 字数: { content: 'Write 1000 words.' } } },
        { checkbox: { Planning: 'false' } },
    ]) assert.throws(() => parseContinuationInputs(inputs))
})

test('checkbox defaults, explicit false, display labels and required checks match the panel', async () => {
    const f = fixture()
    const checkbox = createPromptCheckboxInput()
    checkbox.name = 'Planning'; checkbox.required = true
    checkbox.checkbox = { displayName: 'Think first', defaultChecked: true }
    f.prompt.inputs = [checkbox]
    f.prompt.messages = [{ role: 'user', content: '{% if inputs["Planning"].value %}{{ inputs["Planning"].value }}{% else %}NO PLANNING{% endif %}' }]
    assert.equal((await f.compose()).result.markdown, '## user\n\nThink first\n')
    const unchecked = await f.compose(parseContinuationInputs({ checkbox: { Planning: false } }))
    assert.equal(unchecked.result.markdown, '## user\n\nNO PLANNING\n')
    assert.deepEqual(unchecked.result.missingInputs, ['Planning'])
    checkbox.checkbox.displayName = ''
    assert.equal((await f.compose({ checkbox: { Planning: true } })).result.markdown, '## user\n\nPlanning\n')
    checkbox.checkbox.defaultChecked = false
    checkbox.required = false
    assert.deepEqual((await f.compose()).result.missingInputs, [])
})

test('content selection respects cardinality, term categories, archived terms and clearing', async () => {
    const f = fixture()
    f.prompt.inputs = [f.input]
    f.prompt.messages = [{ role: 'user', content: '{{ inputs["资料"].value }}' }]
    const selections = [{ kind: 'scene', sceneId: 'scene' }, { kind: 'snippet', snippetId: 'snippet' }]
    assert.equal((await f.compose({ contentSelection: { 资料: selections } })).ok, true)
    f.input.contentSelection.allowMultiple = false
    assert.equal((await f.compose({ contentSelection: { 资料: selections } })).ok, false)
    assert.equal((await f.compose({ contentSelection: { 资料: selections.slice(0, 1) } })).ok, true)
    assert.deepEqual((await f.compose({ contentSelection: { 资料: [] } })).result.missingInputs, ['资料'])
    const term = { contentSelection: { 资料: [{ kind: 'term', termId: 'term' }] } }
    f.input.contentSelection.options.term.allowedTypes.characters = false
    assert.equal((await f.compose(term)).ok, false)
    f.input.contentSelection.options.term.allowedTypes.characters = true
    assert.equal((await f.compose(term)).ok, true)
    f.db.novelTermState.findUnique = async () => ({ stateJson: JSON.stringify({ entries: [{ id: 'term', title: '云依', categoryId: 'characters', archived: true }] }) })
    assert.equal((await f.compose(term)).ok, false)
})

test('panel snapshots preserve the structured input state and compose to the same custom value', async () => {
    const f = customFixture()
    const value = { kind: 'custom', dropdownOptionIds: ['fallback'], text: 'Author text' }
    const inputs = continuationInputsFromValues(f.prompt.inputs, { 字数: value })
    assert.deepEqual(inputs.custom.字数, { dropdownOptionIds: ['fallback'], text: 'Author text' })
    assert.notEqual(inputs.custom.字数.dropdownOptionIds, value.dropdownOptionIds)
    assert.equal((await f.compose(parseContinuationInputs(inputs))).result.markdown, '## user\n\nUse dialogue.\n\nAuthor text\n')
})

test('initial handoff writes the saved configuration and current draft', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onw-handoff-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const snapshot = { promptName: 'Writer', instruction: 'Write', inputDefinitions: [], inputs: {}, messages: [{ role: 'system', content: 'STYLE' }, { role: 'user', content: 'CONTEXT' }], modelGroupIds: [], missingInputs: ['资料'] }
    const draft = { panelId: 'panel', novelId: 'novel', chapterId: 'chapter', sceneId: 'scene', codexSessionId: 'session', content: 'AUTHOR DRAFT', planning: 'PLAN', updatedAt: new Date(), promptSnapshotJson: JSON.stringify(snapshot) }
    const queries = []
    const { prepareContinuationHandoff } = load('lib/server/continuation-handoff.ts', {
        '@/lib/db': { prisma: { sceneContinuationDraft: { findFirst: async (query) => { queries.push(query); return draft } }, aiModelGroup: { findMany: async () => [] } } },
        '@/lib/server/codex-session-workspace': { ensureCodexSessionWorkspace: async () => directory },
    })
    const first = await prepareContinuationHandoff({ ownerId: 'owner', sessionId: 'session', novelId: 'novel', panelId: 'panel' })
    const firstPath = path.join(directory, 'artifacts', first.fileNames[0])
    assert.deepEqual(parseLlmConversation(fs.readFileSync(firstPath, 'utf8')), [
        ...snapshot.messages,
        { role: 'assistant', content: '<Planning>\nPLAN\n</Planning>\n\n<Content>\nAUTHOR DRAFT\n</Content>' },
    ])
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'artifacts', first.fileNames[1]))).missingInputs, ['资料'])
    assert.match(first.instruction, /panelId=panel/)
    assert.deepEqual(queries[0].where, { panelId: 'panel', codexSessionId: 'session', novelId: 'novel', novel: { ownerId: 'owner' } })
})

test('handoff refuses a missing or unrelated panel instead of running without its context', async () => {
    const { prepareContinuationHandoff } = load('lib/server/continuation-handoff.ts', { '@/lib/db': { prisma: { sceneContinuationDraft: { findFirst: async () => null } } }, '@/lib/server/codex-session-workspace': {} })
    await assert.rejects(prepareContinuationHandoff({ ownerId: 'owner', sessionId: 'session', novelId: 'novel', panelId: 'foreign' }), /no prompt snapshot/)
})

test('creating a continuation session only links a saved panel; repeated handoff opens its existing session', async () => {
    let created = 0
    let linked = null
    const saved = { id: 'session', category: 'scene_continuation', continuationPanelId: 'panel', messagesJson: '[]', draftArtifactsJson: '[]', draftAttachmentsJson: '[]', draftContent: '', createdAt: new Date(), updatedAt: new Date() }
    const db = {
        novel: { findFirst: async () => ({ id: 'novel', codexSessionAutoCleanup: false }) },
        codexConnection: { findFirst: async () => null },
        sceneContinuationDraft: { findFirst: async () => ({ panelId: 'panel', codexSessionId: linked }), update: async ({ data }) => { linked = data.codexSessionId } },
        codexSession: { create: async ({ data }) => { created++; return { ...saved, ...data, id: 'session' } }, findFirst: async () => saved },
    }
    const route = load('app/api/novels/[id]/codex/sessions/route.ts', { '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) }, '@/lib/db': { getPrismaClient: () => db } }, true)
    const request = () => route.POST(new Request('http://localhost/sessions', { method: 'POST', body: JSON.stringify({ category: 'scene_continuation', panelId: 'panel' }) }), { params: Promise.resolve({ id: 'novel' }) })
    const first = await request()
    assert.equal(first.status, 201)
    assert.equal((await first.json()).session.continuationPanelId, 'panel')
    assert.equal(linked, 'session')
    const second = await request()
    assert.equal(second.status, 200)
    assert.equal((await second.json()).session.id, 'session')
    assert.equal(created, 1)
})

test('deleting a Codex session detaches its panel while retaining the draft', async () => {
    const draft = { codexSessionId: 'session', content: 'KEEP AUTHOR DRAFT' }
    const { deleteCodexSession } = load('lib/server/codex-session-deletion.ts', {
        '@/lib/db': { prisma: {
            codexSession: { findFirst: async () => ({ id: 'session', ownerId: 'owner' }), deleteMany: async () => ({ count: 1 }) },
            sceneEdit: { updateMany: async () => ({ count: 0 }) },
            sceneContinuationDraft: { updateMany: async ({ data }) => Object.assign(draft, data) },
        } },
        '@/lib/server/codex-app-server': { interruptAndWaitForActiveCodexRun: async () => {} },
        '@/lib/server/codex-session-workspace': { deleteCodexSessionWorkspace: async () => {} },
        '@/lib/server/image-gc': { scheduleImageGcSweep() {} },
    })
    assert.equal(await deleteCodexSession('owner', 'session'), true)
    assert.equal(draft.codexSessionId, null)
    assert.equal(draft.content, 'KEEP AUTHOR DRAFT')
})


test('continuation sends artifacts only on its first turn; later turns and steering preserve edited files', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onw-handoff-turns-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const now = new Date()
    let row = { id: 'session', ownerId: 'owner', novelId: 'novel', category: 'scene_continuation', continuationPanelId: 'panel', status: 'idle', composerMode: 'default', messagesJson: '[]', draftAttachmentsJson: '[]', draftArtifactsJson: '[]', createdAt: now, updatedAt: now }
    const snapshot = { promptName: 'Writer', instruction: 'Write', inputDefinitions: [], inputs: {}, messages: [{ role: 'system', content: 'FROZEN STYLE' }], modelGroupIds: [], missingInputs: [] }
    const draft = { panelId: 'panel', novelId: 'novel', chapterId: 'chapter', sceneId: 'scene', content: 'INITIAL DRAFT', planning: '', updatedAt: now, promptSnapshotJson: JSON.stringify(snapshot) }
    let handoffs = 0
    const db = {
        codexSession: {
            findFirst: async () => row,
            updateMany: async ({ data }) => { row = { ...row, ...data }; return { count: 1 } },
            update: async ({ data }) => { row = { ...row, ...data }; return row },
        },
        sceneContinuationDraft: { findFirst: async () => { handoffs++; return draft } },
        aiModelGroup: { findMany: async () => [] },
    }
    const calls = [], steers = []
    const mocks = {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/db': { prisma: db, getPrismaClient: () => db },
        '@/lib/server/codex-session-workspace': { ensureCodexSessionWorkspace: async () => directory, getCodexSessionWorkspacePath: () => directory },
        '@/lib/server/codex-session-skills': {
            CodexSkillUnavailableError: class extends Error {},
            resolveCodexSessionSkillReferences: async () => [], rewriteCodexSkillReferences: (content) => content,
        },
        '@/lib/server/codex-app-server': {
            reserveActiveCodexRun: () => ({}), finishActiveCodexRun: () => {}, isCodexRunInterruptedError: () => false,
            runNovelCodexTurn: async (input) => { calls.push(input); return { status: 'completed', threadId: 'thread', assistantMessages: [{ id: `reply-${calls.length}`, content: 'Received.', createdAt: now.toISOString() }] } },
            steerActiveCodexRun: async (input) => { steers.push(input) },
        },
        ...Object.fromEntries(['storage', 'codex-assistant-text', 'codex-live-messages', 'codex-message-projection'].map((name) => [`@/lib/server/${name}`, jiti(`@/lib/server/${name}`)])),
    }
    mocks['@/lib/server/continuation-handoff'] = load('lib/server/continuation-handoff.ts', mocks)
    const route = load('app/api/codex/sessions/[id]/messages/route.ts', mocks, true)
    const send = async (content, artifactFiles = []) => {
        const response = await route.POST(new Request('http://localhost/messages', { method: 'POST', body: JSON.stringify({ messageId: `message-${calls.length}`, content, artifactFiles }) }), { params: Promise.resolve({ id: 'session' }) })
        assert.equal(response.status, 200)
        assert.doesNotMatch(await response.text(), /event: error/)
    }
    const codexTask = 'Check the prompt for missing inputs'
    await send(codexTask)
    const files = JSON.parse(row.messagesJson).find((message) => message.role === 'user').jsonArtifacts
    assert.equal(files.length, 2)
    assert.match(calls[0].prompt, /panelId=panel/)
    assert.ok(calls[0].prompt.startsWith(codexTask))
    assert.ok(calls[0].prompt.includes(files[0]))
    const markdownPath = path.join(directory, 'artifacts', files[0])
    assert.ok(!fs.readFileSync(markdownPath, 'utf8').includes(codexTask))
    assert.deepEqual(parseLlmConversation(fs.readFileSync(markdownPath, 'utf8')).map((message) => message.role), ['system', 'assistant'])
    fs.writeFileSync(markdownPath, 'CODEX EDIT')
    draft.content = 'AUTHOR EDIT'
    await send('Improve the dialogue')
    assert.equal(calls[1].prompt, 'Improve the dialogue')
    assert.equal(calls[1].codexThreadId, 'thread')
    assert.deepEqual(JSON.parse(row.messagesJson).filter((message) => message.role === 'user')[1].jsonArtifacts, [])
    fs.writeFileSync(path.join(directory, 'artifacts', 'manual.md'), 'AUTHOR NOTES')
    await send('Use my notes', ['manual.md'])
    assert.match(calls[2].prompt, /artifacts\/manual.md/)
    assert.doesNotMatch(calls[2].prompt, /continuation-|panelId=/)
    const steer = load('app/api/codex/sessions/[id]/steer/route.ts', mocks, true)
    row.status = 'running'
    const response = await steer.POST(new Request('http://localhost/steer', { method: 'POST', body: JSON.stringify({ content: 'Keep the ending', artifactFiles: ['manual.md'] }) }), { params: Promise.resolve({ id: 'session' }) })
    assert.equal(response.status, 200)
    assert.equal(steers[0].message, 'Keep the ending')
    assert.deepEqual(steers[0].artifactFiles, ['manual.md'])
    assert.equal(handoffs, 1)
    assert.equal(fs.readFileSync(markdownPath, 'utf8'), 'CODEX EDIT')
    assert.deepEqual(fs.readdirSync(path.join(directory, 'artifacts')).sort(), [...files, 'manual.md'].sort())
})

test('linked continuation configuration is immutable while its draft remains editable', async () => {
    const row = { panelId: 'panel', novelId: 'novel', sceneId: 'scene', chapterId: 'chapter', codexSessionId: 'session', promptSnapshotJson: '{"instruction":"ORIGINAL"}', content: 'BEFORE', planning: '', createdAt: new Date(), updatedAt: new Date() }
    let saves = 0
    const route = load('app/api/continuation-drafts/[panelId]/route.ts', {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/db': { prisma: {
            novel: { findFirst: async () => ({ id: 'novel' }) }, scene: { findFirst: async () => ({ id: 'scene' }) },
            sceneContinuationDraft: { findUnique: async () => row, upsert: async ({ update }) => { saves++; Object.assign(row, update); return row } },
        } },
        '@/lib/server/continuation-draft': { serializeContinuationDraft: (draft) => draft },
    }, true)
    const save = (extra) => route.PUT(new Request('http://localhost/draft', { method: 'PUT', body: JSON.stringify({ novelId: 'novel', sceneId: 'scene', chapterId: 'chapter', content: 'AFTER', planning: 'NEW PLAN', ...extra }) }), { params: Promise.resolve({ panelId: 'panel' }) })
    assert.equal((await save({ promptSnapshotJson: '{"instruction":"CHANGED"}' })).status, 409)
    assert.equal(saves, 0)
    assert.equal((await save({})).status, 200)
    assert.equal(row.content, 'AFTER')
    assert.equal(row.planning, 'NEW PLAN')
    assert.equal(row.promptSnapshotJson, '{"instruction":"ORIGINAL"}')
})
