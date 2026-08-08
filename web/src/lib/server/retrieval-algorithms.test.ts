import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
    cosineSimilarity,
    getRetrievalCandidateLimit,
    rankBm25,
    reciprocalRankFusion,
    tokenizeForRetrieval,
} from './retrieval-algorithms'

test('tokenizes two-character Chinese names as bigrams', () => {
    assert.ok(tokenizeForRetrieval('玄铁').includes('c2:玄铁'))
})

test('BM25 ranks an exact Chinese name match first', () => {
    const results = rankBm25('玄铁在哪里', [
        { id: 'exact', text: '玄铁被藏在石室中。' },
        { id: 'other', text: '长剑被带回了客栈。' },
    ], 10)
    assert.equal(results[0]?.id, 'exact')
})

test('RRF rewards candidates returned by both retrievers', () => {
    const results = reciprocalRankFusion([
        [{ id: 'shared', score: 1, rank: 2 }, { id: 'lexical', score: 1, rank: 1 }],
        [{ id: 'shared', score: 1, rank: 2 }, { id: 'semantic', score: 1, rank: 1 }],
    ], 10)
    assert.equal(results[0]?.id, 'shared')
})

test('computes cosine similarity and candidate pool limits', () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
    assert.equal(getRetrievalCandidateLimit(5), 40)
    assert.equal(getRetrievalCandidateLimit(30), 100)
})
