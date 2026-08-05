import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createDefaultCodexProviderModel } from '@/lib/codex-config'
import {
    applyCodexUpstreamModelCapabilities,
    applyDeepSeekV4ModelDefaults,
    baseDeepSeekModelSlug,
    buildOfficialDeepSeekCatalogEntry,
    isDeepSeekV4ModelId,
    isOfficialDeepSeekResponsesProvider,
    shouldUseOfficialDeepSeekCatalog,
} from '@/lib/codex-deepseek'

test('createDefaultCodexProviderModel seeds DeepSeek V4 defaults immediately', () => {
    const model = createDefaultCodexProviderModel('deepseek-v4-flash')
    assert.equal(model.contextWindow, 1_048_576)
    assert.deepEqual(model.supportedReasoningEfforts, ['low', 'high', 'max'])
    assert.equal(model.defaultReasoningEffort, 'high')
    assert.deepEqual(model.inputModalities, ['text'])
})

test('DeepSeek V4 model detection ignores provider prefixes and router suffixes', () => {
    assert.equal(baseDeepSeekModelSlug('deepseek/deepseek-v4-flash'), 'deepseek-v4-flash')
    assert.equal(baseDeepSeekModelSlug('deepseek-v4-pro:baidu'), 'deepseek-v4-pro')
    assert.equal(isDeepSeekV4ModelId('deepseek/deepseek-v4-flash'), true)
    assert.equal(isDeepSeekV4ModelId('deepseek/deepseek-v4-pro:nitro'), true)
    assert.equal(isDeepSeekV4ModelId('z-ai/glm-5.2:baidu'), false)
})

test('aggregator DeepSeek models get the same capability defaults without an official host', () => {
    const model = applyCodexUpstreamModelCapabilities({
        id: 'deepseek/deepseek-v4-flash',
        displayName: 'deepseek/deepseek-v4-flash',
        contextWindow: 300_000,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'high',
        supportsParallelToolCalls: false,
        inputModalities: ['text', 'image'],
    }, 'responses', 'https://zenmux.ai/api/v1')

    assert.equal(model.contextWindow, 1_048_576)
    assert.deepEqual(model.supportedReasoningEfforts, ['low', 'high', 'max'])
    assert.equal(model.supportsParallelToolCalls, true)
    assert.deepEqual(model.inputModalities, ['text'])
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
    const model = applyDeepSeekV4ModelDefaults({
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
    const entry = buildOfficialDeepSeekCatalogEntry(applyDeepSeekV4ModelDefaults({
        id: 'deepseek-v4-flash',
        displayName: 'DeepSeek V4 Flash',
        contextWindow: 300_000,
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high',
        supportsParallelToolCalls: true,
        inputModalities: ['text'],
    }), 0)
    assert.equal(entry.supports_search_tool, true)
    assert.equal(entry.context_window, 1_048_576)
    assert.equal(entry.apply_patch_tool_type, 'freeform')
})
