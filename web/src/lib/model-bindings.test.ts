import assert from 'node:assert/strict'
import test from 'node:test'

import { syncModelBindingSelection } from './model-bindings'

const setA = 'set-reasoning'
const groupA = 'gemini-pro'
const groupB = 'deepseek'
const groupC = 'glm'
const extra = 'manual-extra'

test('adds new members of a bound model set', () => {
    const previous = new Map([[setA, [groupA, groupB]]])
    const current = new Map([[setA, [groupA, groupB, groupC]]])
    const allowedGroupIds = new Set([groupA, groupB, groupC, extra])

    const next = syncModelBindingSelection({
        selection: { modelGroupIds: [groupA, groupB, extra], modelSetIds: [setA] },
        modelSetGroupIdsById: current,
        previousModelSetGroupIdsById: previous,
        allowedGroupIds,
    })

    assert.equal(next.changed, true)
    assert.deepEqual(next.modelGroupIds, [groupA, groupB, extra, groupC])
    assert.deepEqual(next.modelSetIds, [setA])
})

test('removes members that left a bound model set and keeps extras', () => {
    const previous = new Map([[setA, [groupA, groupB, groupC]]])
    const current = new Map([[setA, [groupA, groupC]]])
    const allowedGroupIds = new Set([groupA, groupB, groupC, extra])

    const next = syncModelBindingSelection({
        selection: { modelGroupIds: [groupA, groupB, groupC, extra], modelSetIds: [setA] },
        modelSetGroupIdsById: current,
        previousModelSetGroupIdsById: previous,
        allowedGroupIds,
    })

    assert.equal(next.changed, true)
    assert.deepEqual(next.modelGroupIds, [groupA, groupC, extra])
    assert.deepEqual(next.modelSetIds, [setA])
})

test('drops deleted model groups without touching remaining bindings', () => {
    const current = new Map([[setA, [groupA, groupC]]])
    const allowedGroupIds = new Set([groupA, groupC])

    const next = syncModelBindingSelection({
        selection: { modelGroupIds: [groupA, groupB, groupC], modelSetIds: [setA] },
        modelSetGroupIdsById: current,
        allowedGroupIds,
    })

    assert.equal(next.changed, true)
    assert.deepEqual(next.modelGroupIds, [groupA, groupC])
    assert.deepEqual(next.modelSetIds, [setA])
})

test('unbinds a deleted model set and removes members not kept by another set', () => {
    const previous = new Map([
        [setA, [groupA, groupB]],
        ['set-fast', [groupC]],
    ])
    const current = new Map([['set-fast', [groupC]]])
    const allowedGroupIds = new Set([groupA, groupB, groupC, extra])

    const next = syncModelBindingSelection({
        selection: { modelGroupIds: [groupA, groupB, groupC, extra], modelSetIds: [setA, 'set-fast'] },
        modelSetGroupIdsById: current,
        previousModelSetGroupIdsById: previous,
        allowedGroupIds,
    })

    assert.equal(next.changed, true)
    assert.deepEqual(next.modelGroupIds, [groupC, extra])
    assert.deepEqual(next.modelSetIds, ['set-fast'])
})

test('keeps a bound set tag even when it currently has no LLM members', () => {
    const previous = new Map([[setA, [groupA]]])
    const current = new Map([[setA, []]])
    const allowedGroupIds = new Set([groupA, extra])

    const next = syncModelBindingSelection({
        selection: { modelGroupIds: [groupA, extra], modelSetIds: [setA] },
        modelSetGroupIdsById: current,
        previousModelSetGroupIdsById: previous,
        allowedGroupIds,
    })

    assert.equal(next.changed, true)
    assert.deepEqual(next.modelGroupIds, [extra])
    assert.deepEqual(next.modelSetIds, [setA])
})
