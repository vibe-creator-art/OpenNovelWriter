import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PrismaClient } from '@/generated/prisma/client'
import {
    createStoryMoment,
    deleteStoryMoment,
    hashStoryContent,
    isCredibleStoryFact,
    isStaleCredibleStoryFact,
    normalizeStoryName,
    storyEpisodeSyncStatus,
} from './story-state'

type TestMoment = {
    id: string
    novelId: string
    label: string
    storyOrder: number
    sourceSceneId: string | null
    episodeCount?: number
    factsStarting?: number
    factsEnding?: number
}

function createMomentTestDatabase(initial: TestMoment[]) {
    const moments = [...initial]
    let nextId = 1
    const storyMoment = {
        findFirst: async ({ where }: { where: { id: string; novelId: string } }) => {
            const moment = moments.find((item) => item.id === where.id && item.novelId === where.novelId)
            if (!moment) return null
            return {
                ...moment,
                _count: {
                    episodes: moment.episodeCount ?? 0,
                    factsStarting: moment.factsStarting ?? 0,
                    factsEnding: moment.factsEnding ?? 0,
                },
            }
        },
        count: async ({ where }: { where: { novelId: string } }) =>
            moments.filter((item) => item.novelId === where.novelId).length,
        updateMany: async ({
            where,
            data,
        }: {
            where: { novelId: string; storyOrder: { gte?: number; gt?: number } }
            data: { storyOrder: { increment?: number; decrement?: number } }
        }) => {
            let count = 0
            for (const moment of moments) {
                if (moment.novelId !== where.novelId) continue
                if (where.storyOrder.gte !== undefined && moment.storyOrder < where.storyOrder.gte) continue
                if (where.storyOrder.gt !== undefined && moment.storyOrder <= where.storyOrder.gt) continue
                moment.storyOrder += data.storyOrder.increment ?? 0
                moment.storyOrder -= data.storyOrder.decrement ?? 0
                count += 1
            }
            return { count }
        },
        create: async ({ data }: { data: Omit<TestMoment, 'id'> }) => {
            const moment = { id: `new-${nextId++}`, ...data }
            moments.push(moment)
            return moment
        },
        delete: async ({ where }: { where: { id: string } }) => {
            const index = moments.findIndex((item) => item.id === where.id)
            if (index < 0) throw new Error('Story moment not found.')
            const [removed] = moments.splice(index, 1)
            return removed
        },
    }
    const transaction = { storyMoment }
    const prisma = {
        novel: { findFirst: async () => ({ id: 'novel-1' }) },
        $transaction: async <T>(run: (tx: typeof transaction) => Promise<T>) => run(transaction),
    } as unknown as PrismaClient
    return { prisma, moments }
}

test('inserts Moments after a predecessor and at the beginning with dense generated order', async () => {
    const { prisma, moments } = createMomentTestDatabase([
        { id: 'a', novelId: 'novel-1', label: '第一日', storyOrder: 0, sourceSceneId: null },
        { id: 'b', novelId: 'novel-1', label: '第三日', storyOrder: 1, sourceSceneId: null },
    ])

    const middle = await createStoryMoment(prisma, {
        ownerId: 'owner-1',
        novelId: 'novel-1',
        label: '第二日',
        afterMomentId: 'a',
    })
    assert.equal(middle.storyOrder, 1)
    assert.deepEqual(
        moments.sort((left, right) => left.storyOrder - right.storyOrder).map((item) => [item.label, item.storyOrder]),
        [['第一日', 0], ['第二日', 1], ['第三日', 2]]
    )

    const first = await createStoryMoment(prisma, {
        ownerId: 'owner-1',
        novelId: 'novel-1',
        label: '序章之前',
    })
    assert.equal(first.storyOrder, 0)
    assert.deepEqual(
        moments.sort((left, right) => left.storyOrder - right.storyOrder).map((item) => item.storyOrder),
        [0, 1, 2, 3]
    )
})

test('normalizes story names and hashes equivalent normalized content consistently', () => {
    assert.equal(normalizeStoryName(' 奥西利亚·312 年 '), '奥西利亚312年')
    assert.equal(hashStoryContent('  洛海瑶归来  '), hashStoryContent('洛海瑶归来'))
    assert.equal(hashStoryContent('Ａ'), hashStoryContent('A'))
})

test('uses only active support and invalidation evidence for Fact credibility', () => {
    const activeSupport = { role: 'SUPPORTS', episode: { inactiveAt: null } }
    const inactiveSupport = { role: 'SUPPORTS', episode: { inactiveAt: new Date() } }
    const activeInvalidation = { role: 'INVALIDATES', episode: { inactiveAt: null } }
    const inactiveInvalidation = { role: 'INVALIDATES', episode: { inactiveAt: new Date() } }

    assert.equal(isCredibleStoryFact({ evidence: [activeSupport] }), true)
    assert.equal(isCredibleStoryFact({ evidence: [inactiveSupport] }), false)
    assert.equal(isCredibleStoryFact({ evidence: [activeSupport, inactiveInvalidation] }), true)
    assert.equal(isCredibleStoryFact({ evidence: [activeSupport, activeInvalidation] }), false)
})

test('derives Episode syncStatus from summary hash without using inactiveAt for drift', () => {
    const hash = hashStoryContent('林晚秋夺剑')
    assert.equal(storyEpisodeSyncStatus({
        sourceKind: 'SCENE_SUMMARY',
        inactiveAt: null,
        contentHash: hash,
        sourceSceneSummary: '林晚秋夺剑',
    }), 'fresh')
    assert.equal(storyEpisodeSyncStatus({
        sourceKind: 'SCENE_SUMMARY',
        inactiveAt: null,
        contentHash: hash,
        sourceSceneSummary: '林晚秋夺剑，夜雨',
    }), 'outdated')
    assert.equal(storyEpisodeSyncStatus({
        sourceKind: 'SCENE_SUMMARY',
        inactiveAt: null,
        contentHash: hash,
        sourceSceneSummary: '   ',
    }), 'source_empty')
    assert.equal(storyEpisodeSyncStatus({
        sourceKind: 'SCENE_SUMMARY',
        inactiveAt: new Date(),
        contentHash: hash,
        sourceSceneSummary: '林晚秋夺剑，夜雨',
    }), 'inactive')
    assert.equal(storyEpisodeSyncStatus({
        sourceKind: 'MANUAL',
        inactiveAt: null,
        contentHash: hash,
        sourceSceneSummary: 'unrelated',
    }), 'fresh')
})

test('marks a Fact stale-credible only when every active SUPPORTS source has drifted', () => {
    const outdated = { role: 'SUPPORTS', episode: { inactiveAt: null, syncStatus: 'outdated' as const } }
    const empty = { role: 'SUPPORTS', episode: { inactiveAt: null, syncStatus: 'source_empty' as const } }
    const fresh = { role: 'SUPPORTS', episode: { inactiveAt: null, syncStatus: 'fresh' as const } }
    const inactive = { role: 'SUPPORTS', episode: { inactiveAt: new Date(), syncStatus: 'inactive' as const } }

    assert.equal(isStaleCredibleStoryFact({ evidence: [outdated] }), true)
    assert.equal(isStaleCredibleStoryFact({ evidence: [outdated, empty] }), true)
    assert.equal(isStaleCredibleStoryFact({ evidence: [outdated, fresh] }), false)
    assert.equal(isStaleCredibleStoryFact({ evidence: [outdated, inactive] }), true)
    assert.equal(isStaleCredibleStoryFact({ evidence: [inactive] }), false)
})

test('deletes unreferenced Moments and refuses Moments that still have references', async () => {
    const { prisma, moments } = createMomentTestDatabase([
        { id: 'a', novelId: 'novel-1', label: '第一日', storyOrder: 0, sourceSceneId: null },
        { id: 'b', novelId: 'novel-1', label: '第二日', storyOrder: 1, sourceSceneId: null },
        { id: 'c', novelId: 'novel-1', label: '第三日', storyOrder: 2, sourceSceneId: null },
        { id: 'used', novelId: 'novel-1', label: '仍被引用', storyOrder: 3, sourceSceneId: null, episodeCount: 1 },
    ])

    await deleteStoryMoment(prisma, { ownerId: 'owner-1', novelId: 'novel-1', momentId: 'b' })
    assert.deepEqual(
        moments.sort((left, right) => left.storyOrder - right.storyOrder).map((item) => [item.id, item.storyOrder]),
        [['a', 0], ['c', 1], ['used', 2]]
    )

    await assert.rejects(
        () => deleteStoryMoment(prisma, { ownerId: 'owner-1', novelId: 'novel-1', momentId: 'used' }),
        /still has episode or fact references/
    )
})
