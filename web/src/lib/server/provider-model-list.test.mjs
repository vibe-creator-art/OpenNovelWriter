import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
    parseOpenAiModelList,
    requireProviderModels,
} from './provider-model-list.ts'

describe('provider model list', () => {
    test('drops entries with missing or empty model IDs', () => {
        assert.deepEqual(
            parseOpenAiModelList([
                { id: '' },
                { id: '   ' },
                {},
                null,
                { id: ' gpt-5 ' },
            ]),
            [{ id: 'gpt-5', name: 'gpt-5' }]
        )
    })

    test('rejects a model list with no usable entries', () => {
        assert.throws(
            () => requireProviderModels(parseOpenAiModelList([{ id: '' }])),
            /No models are available/
        )
        assert.throws(
            () => requireProviderModels([]),
            /No models are available/
        )
    })

    test('keeps a non-empty valid model list', () => {
        const models = [{ id: 'gpt-5', name: 'gpt-5' }]
        assert.strictEqual(requireProviderModels(models), models)
    })
})
