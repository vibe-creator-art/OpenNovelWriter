import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
    detectCherryStudioModelTypes,
    inferCherryStudioProviderId,
    resolveCherryStudioIcon,
} from './index'

test('classifies Qwen3 rerankers as reranker only', () => {
    assert.deepEqual(detectCherryStudioModelTypes({ modelId: 'Qwen/Qwen3-Reranker-8B' }), {
        vision: false,
        reasoning: false,
        tool: false,
        reranker: true,
        embedding: false,
    })
})

test('keeps embedding and reranker classifications mutually exclusive', () => {
    const embedding = detectCherryStudioModelTypes({ modelId: 'text-embedding-3-small' })
    const reranker = detectCherryStudioModelTypes({ modelId: 'bge-reranker-v2-m3' })

    assert.equal(embedding.embedding, true)
    assert.equal(embedding.reranker, false)
    assert.equal(reranker.reranker, true)
    assert.equal(reranker.embedding, false)
})

test('only infers reasoning for uncatalogued model ids', () => {
    assert.deepEqual(detectCherryStudioModelTypes({ modelId: 'custom-thinking-model' }), {
        vision: false,
        reasoning: true,
        tool: false,
        reranker: false,
        embedding: false,
    })
    assert.deepEqual(detectCherryStudioModelTypes({ modelId: 'custom-chat-model' }), {
        vision: false,
        reasoning: false,
        tool: false,
        reranker: false,
        embedding: false,
    })
})

test('uses provider registry base URLs and latest icon routing', () => {
    const providerId = inferCherryStudioProviderId({
        baseUrl: 'https://api.siliconflow.cn/v1',
        providerType: 'openai-chat',
    })

    assert.equal(providerId, 'silicon')
    assert.deepEqual(resolveCherryStudioIcon('gpt-5.4-mini', providerId), {
        kind: 'model',
        key: 'gpt-5-4-mini',
    })
    assert.deepEqual(resolveCherryStudioIcon('k3', providerId), {
        kind: 'model',
        key: 'kimi',
    })
    assert.notEqual(resolveCherryStudioIcon('taiwan-llm', providerId)?.key, 'qwen')
})
