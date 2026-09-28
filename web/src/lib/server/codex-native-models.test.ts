import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultCodexProviderModel } from '@/lib/codex-config'
import { findCodexNativeModel, resolveCodexProviderModels } from './codex-native-models'

const native = {
    slug: 'gpt-future', display_name: 'Future GPT', visibility: 'list', context_window: 750_000,
    supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }], default_reasoning_level: 'low',
    supports_parallel_tool_calls: true, input_modalities: ['text', 'image'],
}

test('model resolution uses the most specific native model, including provider and snapshot IDs', () => {
    const snapshot = { ...native, slug: 'gpt-future-2026-09-25' }
    const models = [native, snapshot]
    assert.equal(findCodexNativeModel(models, 'openai/gpt-future:fast'), native)
    assert.equal(findCodexNativeModel(models, 'gpt-future-2026-09-25'), snapshot)
    assert.equal(findCodexNativeModel(models, 'gpt-future-other-snapshot'), native)
    assert.equal(findCodexNativeModel(models, 'gpt-futures'), undefined)
})

test('native capabilities replace saved GPT values and newly available models reach the picker', () => {
    const hidden = { ...native, slug: 'gpt-hidden', visibility: 'hide' }
    const newer = { ...native, slug: 'gpt-newer' }
    const models = resolveCodexProviderModels([createDefaultCodexProviderModel('openai/gpt-future')], [native, newer, hidden])
    assert.deepEqual(models.map((model) => model.id), ['openai/gpt-future', 'gpt-future', 'gpt-newer'])
    assert.equal(models[0].contextWindow, native.context_window)
    assert.deepEqual(models[0].supportedReasoningEfforts, ['low', 'high'])
    assert.equal(models[0].defaultReasoningEffort, 'low')
    assert.equal(models[0].supportsParallelToolCalls, true)
})

test('non-GPT models keep their configured capabilities', () => {
    const model = createDefaultCodexProviderModel('custom-model')
    assert.deepEqual(resolveCodexProviderModels([model], [native]), [model])
})

test('OpenCode keeps only configured models while inheriting native GPT capabilities', () => {
    const custom = createDefaultCodexProviderModel('custom-model')
    const configured = [custom, createDefaultCodexProviderModel('openai/gpt-future')]
    const nativeModels = [native, { ...native, slug: 'gpt-newer' }]
    for (const baseUrl of ['https://opencode.ai/zen/go/v1', ' https://opencode.ai/zen/go/v1/ ', 'https://opencode.ai/zen/v1']) {
        const models = resolveCodexProviderModels(configured, nativeModels, baseUrl)
        assert.deepEqual(models.map((model) => model.id), ['custom-model', 'openai/gpt-future'])
        assert.deepEqual(models[0], custom)
        assert.equal(models[1].contextWindow, native.context_window)
        assert.deepEqual(models[1].supportedReasoningEfforts, ['low', 'high'])
    }
    for (const baseUrl of ['https://proxy.example/v1', 'https://opencode.ai.example/zen/go/v1']) {
        assert.deepEqual(resolveCodexProviderModels(configured, nativeModels, baseUrl).map((model) => model.id),
            ['custom-model', 'openai/gpt-future', 'gpt-future', 'gpt-newer'])
    }
})
