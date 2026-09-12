import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createDefaultCodexProviderModel } from '@/lib/codex-config'
import {
    applyCodexUpstreamModelCapabilities,
    applyDeepSeekModelDefaults,
    baseDeepSeekModelSlug,
    buildOfficialDeepSeekCatalogEntry,
    isDeepSeekModelId,
    isOfficialDeepSeekResponsesProvider,
    shouldUseOfficialDeepSeekCatalog,
} from '@/lib/codex-deepseek'

for (const id of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash:nitro', 'deepseek-v4-pro']) {
    test(`createDefaultCodexProviderModel seeds capabilities for ${id}`, () => {
        const model = createDefaultCodexProviderModel(id)
        assert.equal(model.id, id)
        assert.equal(model.contextWindow, 1_048_576)
        assert.deepEqual(model.supportedReasoningEfforts, ['low', 'high', 'max'])
        assert.equal(model.defaultReasoningEffort, 'high')
        assert.equal(model.supportsParallelToolCalls, true)
        assert.deepEqual(model.inputModalities, id.endsWith('-pro') ? ['text'] : ['text', 'image'])
    })
}

test('DeepSeek model detection ignores provider prefixes and router suffixes', () => {
    assert.equal(baseDeepSeekModelSlug('deepseek/deepseek-v4-flash'), 'deepseek-v4-flash')
    assert.equal(baseDeepSeekModelSlug('deepseek-v4-pro:baidu'), 'deepseek-v4-pro')
    assert.equal(isDeepSeekModelId('deepseek/deepseek-v4-flash'), true)
    assert.equal(isDeepSeekModelId('deepseek/deepseek-v4-pro:nitro'), true)
    assert.equal(isDeepSeekModelId(' DeepSeek/DeepSeek-V4.1-Flash '), true)
    assert.equal(isDeepSeekModelId('deepseek/deepseek-flash'), true)
    assert.equal(isDeepSeekModelId('deepseek-v4.1-pro'), false)
    assert.equal(isDeepSeekModelId('deepseek-v4.1-flash-expires-on-0910'), false)
    assert.equal(isDeepSeekModelId('z-ai/glm-5.2:baidu'), false)
})

test('aggregator DeepSeek models get the same capability defaults without an official host', () => {
    const model = applyCodexUpstreamModelCapabilities({
        id: 'deepseek/deepseek-v4.1-flash',
        displayName: 'DeepSeek V4.1 Flash',
        contextWindow: 300_000,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'high',
        supportsParallelToolCalls: false,
        inputModalities: ['text'],
    }, 'responses', 'https://zenmux.ai/api/v1')

    assert.equal(model.contextWindow, 1_048_576)
    assert.deepEqual(model.supportedReasoningEfforts, ['low', 'high', 'max'])
    assert.equal(model.supportsParallelToolCalls, true)
    assert.deepEqual(model.inputModalities, ['text', 'image'])
})

test('official catalog is still host-gated; aggregators do not get freeform harness', () => {
    assert.equal(isOfficialDeepSeekResponsesProvider('responses', 'https://api.deepseek.com/v1'), true)
    assert.equal(isOfficialDeepSeekResponsesProvider('responses', 'https://zenmux.ai/api/v1'), false)
    assert.equal(
        shouldUseOfficialDeepSeekCatalog('responses', 'https://zenmux.ai/api/v1', 'deepseek/deepseek-v4-flash'),
        false,
    )
    assert.equal(
        shouldUseOfficialDeepSeekCatalog('responses', 'https://api.deepseek.com/v1', 'deepseek-v4-flash'),
        true,
    )
})

test('unrelated models are left alone', () => {
    const model = applyDeepSeekModelDefaults({
        id: 'gpt-custom',
        displayName: 'Custom',
        contextWindow: 128_000,
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high',
        supportsParallelToolCalls: false,
        inputModalities: ['text'],
    })
    assert.equal(model.contextWindow, 128_000)
})

test('official catalog keeps tool_search deferral enabled', () => {
    const entry = buildOfficialDeepSeekCatalogEntry(applyDeepSeekModelDefaults({
        id: 'deepseek-flash',
        displayName: 'DeepSeek Flash',
        contextWindow: 300_000,
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high',
        supportsParallelToolCalls: true,
        inputModalities: ['text'],
    }), 0)
    assert.equal(entry.supports_search_tool, true)
    assert.equal(entry.context_window, 1_048_576)
    assert.equal(entry.apply_patch_tool_type, 'freeform')
    assert.equal(entry.supports_image_detail_original, true)
    assert.deepEqual(entry.input_modalities, ['text', 'image'])
})
