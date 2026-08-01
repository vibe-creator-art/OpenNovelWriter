import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import type { CodexProviderModel } from '@/lib/codex-config'
import { CODEX_MODEL_CATALOG_FILE, writeCodexModelCatalog } from './codex-model-catalog'

const model: CodexProviderModel = {
    id: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    contextWindow: 1_048_576,
    supportedReasoningEfforts: ['low', 'high', 'max'],
    defaultReasoningEffort: 'high',
    supportsParallelToolCalls: true,
    inputModalities: ['text'],
}

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
        // OpenNovelWriter forces eager tool loading so first-party MCP tools stay
        // in the session tool list instead of hiding behind tool_search.
        assert.equal(entry.supports_search_tool, false)
        assert.equal(entry.minimal_client_version, '0.144.0')
        assert.equal(entry.supports_reasoning_summaries, true)
        assert.equal(entry.model_messages.instructions_template.startsWith('You are Codex, an agent based on GPT-5'), true)
        assert.equal(entry.context_window, 1_048_576)
        assert.deepEqual(entry.supported_reasoning_levels.map((level: { effort: string }) => level.effort), ['low', 'high', 'max'])
        assert.deepEqual(entry.input_modalities, ['text'])
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
            tool_mode: null,
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
        assert.equal(entry.supports_search_tool, false)
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})
