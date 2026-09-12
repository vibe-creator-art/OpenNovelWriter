import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { createDefaultCodexProviderModel, type CodexProviderModel } from '@/lib/codex-config'
import { CODEX_MODEL_CATALOG_FILE, writeCodexModelCatalog } from './codex-model-catalog'

const model: CodexProviderModel = {
    id: 'deepseek-flash',
    displayName: 'DeepSeek Flash',
    contextWindow: 1_048_576,
    supportedReasoningEfforts: ['low', 'high', 'max'],
    defaultReasoningEffort: 'high',
    supportsParallelToolCalls: true,
    inputModalities: ['text', 'image'],
}

test('Astra uses its native instructions, Code Mode, and async questions for custom connections', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennovelwriter-catalog-'))
    try {
        const astraInstructions = { instructions_template: 'Native Astra instructions' }
        await fs.writeFile(path.join(directory, 'models_cache.json'), JSON.stringify({ models: [
            { slug: 'gpt-5.6-sol', base_instructions: 'Sol instructions', model_messages: { instructions_template: 'Sol template' } },
            { slug: 'gpt-6-astra', base_instructions: 'Astra instructions', model_messages: astraInstructions, tool_mode: 'code_mode_only', use_responses_lite: true },
        ] }))
        for (const upstreamFormat of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
            await writeCodexModelCatalog({
                codexHome: directory, upstreamFormat,
                models: ['gpt-6-astra', 'openai/gpt-6-astra', 'gpt-5.6-sol'].map(createDefaultCodexProviderModel),
            })
            const catalog = JSON.parse(await fs.readFile(path.join(directory, CODEX_MODEL_CATALOG_FILE), 'utf8'))
            for (const entry of catalog.models.slice(0, 2)) {
                assert.equal(entry.tool_mode, 'code_mode_only')
                assert.equal(entry.use_responses_lite, false)
                assert.equal(entry.shell_type, 'unified_exec')
                assert.equal(entry.apply_patch_tool_type, 'freeform')
                assert.equal(entry.base_instructions, 'Astra instructions')
                assert.deepEqual(entry.model_messages, astraInstructions)
                assert.deepEqual(entry.experimental_supported_tools, ['send_user_message_async', 'clock'])
            }
            assert.equal(catalog.models[1].slug, 'openai/gpt-6-astra')
            assert.equal(catalog.models[2].tool_mode, undefined)
            assert.notEqual(catalog.models[2].base_instructions, 'Astra instructions')
        }
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})

test('uses the official DeepSeek tool surface only on the official native Responses host', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennovelwriter-catalog-'))
    try {
        await fs.writeFile(path.join(directory, 'models_cache.json'), JSON.stringify({ models: [{
            slug: 'gpt-5.6-sol',
            base_instructions: 'Codex harness',
            model_messages: { instructions_template: '{base_instructions}' },
            apply_patch_tool_type: 'freeform',
            tool_mode: null,
        }] }))
        await writeCodexModelCatalog({
            codexHome: directory,
            upstreamFormat: 'responses',
            baseUrl: 'https://api.deepseek.com/v1',
            models: [model],
        })
        const catalog = JSON.parse(await fs.readFile(path.join(directory, CODEX_MODEL_CATALOG_FILE), 'utf8'))
        const entry = catalog.models[0]

        assert.equal(entry.apply_patch_tool_type, 'freeform')
        assert.equal(entry.use_responses_lite, false)
        assert.equal(entry.web_search_tool_type, 'text')
        assert.equal(entry.supports_search_tool, true)
        assert.equal(entry.minimal_client_version, '0.144.0')
        assert.equal(entry.supports_reasoning_summaries, true)
        assert.equal(entry.model_messages.instructions_template.startsWith('You are Codex, an agent based on GPT-5'), true)
        assert.equal(entry.context_window, 1_048_576)
        assert.deepEqual(entry.supported_reasoning_levels.map((level: { effort: string }) => level.effort), ['low', 'high', 'max'])
        assert.deepEqual(entry.input_modalities, ['text', 'image'])
        assert.equal(entry.supports_image_detail_original, true)
        assert.deepEqual(entry.service_tiers, [{
            id: 'priority',
            name: 'Fast',
            description: 'Availability, actual speed, and usage depend on the upstream provider.',
        }])
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})

test('V4.1 capabilities reach official and aggregator runtime catalogs without changing model IDs', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennovelwriter-catalog-'))
    try {
        for (const baseUrl of ['https://api.deepseek.com/v1', 'https://zenmux.ai/api/v1']) {
            const ids = ['deepseek/deepseek-v4.1-flash', 'deepseek-v4-flash', 'deepseek-v4-pro']
            await writeCodexModelCatalog({
                codexHome: directory,
                upstreamFormat: 'responses',
                baseUrl,
                models: ids.map((id) => ({
                    ...model,
                    id,
                    displayName: id,
                    contextWindow: 300_000,
                    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
                    inputModalities: ['text'],
                })),
            })
            const catalog = JSON.parse(await fs.readFile(path.join(directory, CODEX_MODEL_CATALOG_FILE), 'utf8'))
            for (const [index, entry] of catalog.models.entries()) {
                assert.equal(entry.slug, ids[index])
                assert.equal(entry.context_window, 1_048_576)
                assert.deepEqual(entry.supported_reasoning_levels.map((level: { effort: string }) => level.effort), ['low', 'high', 'max'])
                assert.deepEqual(entry.input_modalities, ids[index].endsWith('-pro') ? ['text'] : ['text', 'image'])
                assert.equal(entry.supports_search_tool, true)
                assert.equal(entry.apply_patch_tool_type, baseUrl.includes('api.deepseek.com') ? 'freeform' : undefined)
                if (baseUrl.includes('api.deepseek.com')) {
                    assert.equal(entry.supports_image_detail_original, !ids[index].endsWith('-pro'))
                } else {
                    assert.equal(entry.model_messages, undefined)
                }
            }
        }
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})

test('suppresses unsupported custom and hosted tools for Anthropic Messages', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennovelwriter-catalog-'))
    try {
        await fs.writeFile(path.join(directory, 'models_cache.json'), JSON.stringify({ models: [{
            slug: 'gpt-5.6-sol',
            base_instructions: 'Codex harness',
            model_messages: { instructions_template: '{base_instructions}' },
            apply_patch_tool_type: 'freeform',
            web_search_tool_type: 'text',
            tool_mode: 'code_mode_only',
            use_responses_lite: true,
        }] }))
        await writeCodexModelCatalog({
            codexHome: directory,
            upstreamFormat: 'anthropic-messages',
            baseUrl: 'https://api.anthropic.com',
            models: [{ ...model, id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }],
        })
        const catalog = JSON.parse(await fs.readFile(path.join(directory, CODEX_MODEL_CATALOG_FILE), 'utf8'))
        const entry = catalog.models[0]

        assert.equal(entry.apply_patch_tool_type, undefined)
        assert.equal(entry.web_search_tool_type, undefined)
        assert.equal(entry.model_messages, undefined)
        assert.equal(entry.supports_search_tool, true)
        assert.equal(entry.tool_mode, undefined)
        assert.equal(entry.use_responses_lite, false)
        assert.deepEqual(entry.service_tiers, [])
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})

test('uses direct deferred tools for Chat Completions providers with instruction-template catalogs', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennovelwriter-catalog-'))
    try {
        await fs.writeFile(path.join(directory, 'models_cache.json'), JSON.stringify({ models: [{
            slug: 'gpt-5.6-sol',
            model_messages: { instructions_template: 'Codex harness' },
            apply_patch_tool_type: 'freeform',
            tool_mode: 'code_mode_only',
            use_responses_lite: true,
        }] }))
        await writeCodexModelCatalog({
            codexHome: directory,
            upstreamFormat: 'chat-completions',
            baseUrl: 'https://example.com/v1',
            models: [{ ...model, id: 'qwen-coder', displayName: 'Qwen Coder' }],
        })
        const catalog = JSON.parse(await fs.readFile(path.join(directory, CODEX_MODEL_CATALOG_FILE), 'utf8'))
        const entry = catalog.models[0]

        assert.equal(entry.supports_search_tool, true)
        assert.equal(entry.tool_mode, undefined)
        assert.equal(entry.use_responses_lite, false)
        assert.equal(typeof entry.base_instructions, 'string')
        assert.deepEqual(entry.service_tiers, [{
            id: 'priority',
            name: 'Fast',
            description: 'Availability, actual speed, and usage depend on the upstream provider.',
        }])
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})
