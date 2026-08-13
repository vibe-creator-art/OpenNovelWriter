import assert from 'node:assert/strict'
import test from 'node:test'

import type { StoryStateVisualizationFact, StoryStateVisualizationMoment } from '@/lib/api'
import {
    getStoryFactMomentState,
    isStoryFactActiveAt,
    resolveStoryFacts,
} from './story-state-visualization-utils'

const moments: StoryStateVisualizationMoment[] = [
    { id: 'm1', label: '第一刻', storyOrder: 10, sourceScene: null },
    { id: 'm2', label: '第二刻', storyOrder: 20, sourceScene: null },
    { id: 'm3', label: '第三刻', storyOrder: 30, sourceScene: null },
]

function fact(input: Partial<StoryStateVisualizationFact> = {}): StoryStateVisualizationFact {
    return {
        id: 'fact',
        subjectEntityId: 'a',
        predicateKey: 'knows',
        objectEntityId: 'b',
        objectValue: null,
        factText: 'A 认识 B',
        validFromMomentId: null,
        validToMomentId: null,
        credible: true,
        evidence: [],
        staleCredible: false,
        ...input,
    }
}

test('Story Fact validity uses a half-open interval', () => {
    const [resolved] = resolveStoryFacts([
        fact({ validFromMomentId: 'm1', validToMomentId: 'm3' }),
    ], moments)

    assert.equal(isStoryFactActiveAt(resolved, 10), true)
    assert.equal(isStoryFactActiveAt(resolved, 20), true)
    assert.equal(isStoryFactActiveAt(resolved, 30), false)
})

test('Moment changes distinguish starts and ends from persistent facts', () => {
    const [starting, ending, persistent] = resolveStoryFacts([
        fact({ id: 'starting', validFromMomentId: 'm2' }),
        fact({ id: 'ending', validToMomentId: 'm2' }),
        fact({ id: 'persistent' }),
    ], moments)

    assert.equal(getStoryFactMomentState(starting, moments[1]), 'starts')
    assert.equal(getStoryFactMomentState(ending, moments[1]), 'ends')
    assert.equal(getStoryFactMomentState(persistent, moments[1]), 'active')
})
