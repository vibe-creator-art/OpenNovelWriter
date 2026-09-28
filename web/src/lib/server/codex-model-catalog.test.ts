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

test('GPT models inherit the complete native catalog, including future models and capabilities', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennovelwriter-catalog-'))
    try {
        const native = {
            slug: 'gpt-future', display_name: 'Future GPT', visibility: 'list',
            context_window: 1_234_567, max_context_window: 2_000_000,
            supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
            default_reasoning_level: 'low', input_modalities: ['text', 'image'],
            base_instructions: 'Native instructions',
            model_messages: { instructions_template: 'Native template' },
            tool_mode: 'future_mode', use_responses_lite: true,
            experimental_supported_tools: ['new_native_tool'],
            future_capability: { enabled: true },
            service_tiers: [{ id: 'native-fast', name: 'Native Fast' }],
        }
        await fs.writeFile(path.join(directory, 'models_cache.json'), JSON.stringify({ models: [native] }))
        const ids = ['gpt-future', 'openai/gpt-future', 'gpt-future-2026-09-03']
        for (const upstreamFormat of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
            await writeCodexModelCatalog({
                codexHome: directory, upstreamFormat,
                models: ids.map((id) => ({ ...createDefaultCodexProviderModel(id), contextWindow: 100, defaultReasoningEffort: 'high' })),
            })
            const catalog = JSON.parse(await fs.readFile(path.join(directory, CODEX_MODEL_CATALOG_FILE), 'utf8'))
            assert.deepEqual(catalog.models, ids.map((slug) => ({ ...native, slug })))
        }
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})

test('OpenCode catalogs include only configured GPT models with their complete native capabilities', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennovelwriter-opencode-catalog-'))
    try {
        const native = {
            slug: 'gpt-future', display_name: 'Future GPT', visibility: 'list', context_window: 750_000,
            supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }], default_reasoning_level: 'low',
            input_modalities: ['text', 'image'], tool_mode: 'future_mode', future_capability: { enabled: true },
        }
        const newer = { ...native, slug: 'gpt-newer' }
        await fs.writeFile(path.join(directory, 'models_cache.json'), JSON.stringify({ models: [native, newer] }))
        for (const baseUrl of ['https://opencode.ai/zen/go/v1', 'https://opencode.ai/zen/v1']) {
            await writeCodexModelCatalog({
                codexHome: directory, upstreamFormat: 'responses', baseUrl,
                models: [createDefaultCodexProviderModel(native.slug)],
            })
            const catalog = JSON.parse(await fs.readFile(path.join(directory, CODEX_MODEL_CATALOG_FILE), 'utf8'))
            assert.deepEqual(catalog.models, [native])
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
        assert.equal(entry.web_search_tool_type, undefined)
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
