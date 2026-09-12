import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { prepareCodexQuestionPolicy } from './codex-question-policy'
import { CODEX_MODEL_CATALOG_FILE, writeCodexModelCatalog } from './codex-model-catalog'
import { createDefaultCodexProviderModel } from '@/lib/codex-config'

for (const asyncQuestions of [true, false]) {
    test(`enabled questions expose only the ${asyncQuestions ? 'async' : 'synchronous'} path supported by the selected model`, async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-question-policy-'))
        try {
            const models = [
                { slug: 'gpt-6-astra', experimental_supported_tools: ['send_user_message_async', 'clock'], tool_mode: 'code_mode_only', use_responses_lite: true },
                { slug: 'gpt-5.6-sol', experimental_supported_tools: [] },
            ]
            const source = path.join(directory, 'models_cache.json')
            await fs.writeFile(source, JSON.stringify({ models }))
            const result = await prepareCodexQuestionPolicy({ enabled: true, modelId: asyncQuestions ? 'gpt-6-astra' : 'gpt-5.6-sol', codexHome: directory, workspace: directory, config: { developer_instructions: 'Keep the author voice.' } })
            assert.equal(result.config.model_catalog_json, undefined)
            assert.equal(result.config['features.default_mode_request_user_input'], !asyncQuestions)
            assert.equal(result.config['tools.experimental_request_user_input.enabled'], !asyncQuestions)
            assert.ok(result.developerInstructions.startsWith('Keep the author voice.'))
            assert.match(result.developerInstructions, /both Default and Plan modes/)
            assert.ok(result.developerInstructions.includes(asyncQuestions ? 'Use request_user_input_async' : 'Use request_user_input and wait'))
            assert.deepEqual(JSON.parse(await fs.readFile(source, 'utf8')).models, models)
        } finally {
            await fs.rm(directory, { recursive: true, force: true })
        }
    })
}

test('custom Astra automatically exposes async questions and retains Code Mode when questions are disabled', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-question-policy-'))
    try {
        await writeCodexModelCatalog({ codexHome: directory, upstreamFormat: 'responses', models: [createDefaultCodexProviderModel('openai/gpt-6-astra')] })
        const input = { modelId: 'openai/gpt-6-astra', codexHome: directory, workspace: directory, config: { model_catalog_json: CODEX_MODEL_CATALOG_FILE } }
        const enabled = await prepareCodexQuestionPolicy({ ...input, enabled: true })
        assert.equal(enabled.config['tools.experimental_request_user_input.enabled'], false)
        assert.match(enabled.developerInstructions, /Use request_user_input_async/)
        const disabled = await prepareCodexQuestionPolicy({ ...input, enabled: false })
        const model = JSON.parse(await fs.readFile(String(disabled.config.model_catalog_json), 'utf8')).models[0]
        assert.equal(model.tool_mode, 'code_mode_only')
        assert.equal(model.shell_type, 'unified_exec')
        assert.deepEqual(model.experimental_supported_tools, ['clock'])
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})

test('disabled questions filter the async capability without altering native model behavior or shared config', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-question-policy-'))
    try {
        const model = { slug: 'gpt-6-astra', experimental_supported_tools: ['send_user_message_async', 'clock'], tool_mode: 'code_mode_only', use_responses_lite: true, model_messages: { instructions_template: 'Original native prompt' } }
        const source = path.join(directory, 'models_cache.json')
        await fs.writeFile(source, JSON.stringify({ models: [model] }))
        const result = await prepareCodexQuestionPolicy({ enabled: false, modelId: 'gpt-6-astra', codexHome: directory, workspace: directory, config: {} })
        assert.equal(result.config['tools.experimental_request_user_input.enabled'], false)
        const filtered = JSON.parse(await fs.readFile(String(result.config.model_catalog_json), 'utf8')).models[0]
        assert.deepEqual(filtered, { ...model, experimental_supported_tools: ['clock'] })
        assert.deepEqual(JSON.parse(await fs.readFile(source, 'utf8')).models[0], model)
        assert.match(result.developerInstructions, /including Plan mode/)
        const restored = await prepareCodexQuestionPolicy({ enabled: true, modelId: 'gpt-6-astra', codexHome: directory, workspace: directory, config: {} })
        assert.equal(restored.config.model_catalog_json, undefined)
        assert.equal(restored.config['tools.experimental_request_user_input.enabled'], false)
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})
