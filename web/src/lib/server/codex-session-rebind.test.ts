import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
    DEFAULT_CODEX_MODEL,
    expandNativeCodexModels,
    parseCodexProviderModelsJson,
} from '@/lib/codex-config'

// Pure helper logic mirrored for unit coverage without a live DB.
function resolveConnectionDefaultModelId(connection: {
    providerType: string
    defaultModelId: string | null
    modelsJson: string
}) {
    if (connection.providerType === 'custom') {
        const models = expandNativeCodexModels(parseCodexProviderModelsJson(connection.modelsJson))
        const preferred = connection.defaultModelId?.trim() || ''
        if (preferred && models.some((model) => model.id === preferred)) return preferred
        if (models[0]?.id) return models[0].id
    }
    return connection.defaultModelId?.trim() || DEFAULT_CODEX_MODEL
}

test('custom connection default model falls back to first listed model', () => {
    const modelId = resolveConnectionDefaultModelId({
        providerType: 'custom',
        defaultModelId: 'missing-model',
        modelsJson: JSON.stringify([
            {
                id: 'deepseek/deepseek-v4-flash',
                displayName: 'DeepSeek V4 Flash',
                contextWindow: 1_048_576,
                supportedReasoningEfforts: ['low', 'high', 'max'],
                defaultReasoningEffort: 'high',
                supportsParallelToolCalls: true,
                inputModalities: ['text'],
            },
        ]),
    })
    assert.equal(modelId, 'deepseek/deepseek-v4-flash')
})

test('official connection keeps its default model id or built-in fallback', () => {
    assert.equal(resolveConnectionDefaultModelId({
        providerType: 'openai-official',
        defaultModelId: 'gpt-5.6-sol',
        modelsJson: '[]',
    }), 'gpt-5.6-sol')
    assert.equal(resolveConnectionDefaultModelId({
        providerType: 'openai-official',
        defaultModelId: null,
        modelsJson: '[]',
    }), DEFAULT_CODEX_MODEL)
})
