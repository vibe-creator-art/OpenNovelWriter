import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import { getTermStateEntries } from '@/lib/term-state'
import { syncNovelStoryRetrievalIndexes } from '@/lib/server/story-retrieval-index'

export const STORY_ENTITY_KINDS = [
    'CHARACTER',
    'LOCATION',
    'ITEM',
    'ORGANIZATION',
    'EVENT',
    'INFORMATION',
    'CONCEPT',
    'OTHER',
] as const
export const STORY_ALIAS_SOURCE_KINDS = ['TERM', 'MANUAL', 'EXTRACTED'] as const
export const STORY_EPISODE_SYNC_STATUSES = ['fresh', 'outdated', 'source_empty', 'inactive'] as const

export type StoryEntityKind = (typeof STORY_ENTITY_KINDS)[number]
export type StoryAliasSourceKind = (typeof STORY_ALIAS_SOURCE_KINDS)[number]
export type StoryEpisodeSyncStatus = (typeof STORY_EPISODE_SYNC_STATUSES)[number]
type StoryDatabase = PrismaClient | Prisma.TransactionClient
const require = createRequire(import.meta.url)
const storyStateLifecycle = require('./story-state-lifecycle.cjs') as {
    deactivateStoryEpisodesForScene: (
        db: Prisma.TransactionClient,
        sceneId: string
    ) => Promise<void>
}

export type StoryFactAssertion =
    | { factId: string }
    | {
          subjectEntityId: string
          predicateKey: string
          objectEntityId?: string | null
          objectValue?: string | null
          factText: string
          validFromMomentId?: string | null
          validToMomentId?: string | null
      }

export type StoryFactClosure = {
    factId: string
    validToMomentId: string
}

type ApplyEpisodeInput = {
    novelId: string
    sourceKind: 'SCENE_SUMMARY' | 'MANUAL'
    sourceSceneId?: string | null
    content: string
    referenceMomentId?: string | null
    facts: StoryFactAssertion[]
    closeFacts?: StoryFactClosure[]
    invalidateFactIds?: string[]
}

export function normalizeStoryName(value: string) {
    return value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function hashStoryContent(value: string) {
    return createHash('sha256').update(value.normalize('NFKC').trim(), 'utf8').digest('hex')
}

export function storyEpisodeSyncStatus(episode: {
    sourceKind: string
    inactiveAt: Date | string | null
    contentHash: string
    sourceSceneSummary?: string | null
}): StoryEpisodeSyncStatus {
    if (episode.inactiveAt) return 'inactive'
    if (episode.sourceKind !== 'SCENE_SUMMARY') return 'fresh'
    const summary = episode.sourceSceneSummary?.normalize('NFKC').trim() ?? ''
    if (!summary) return 'source_empty'
    return hashStoryContent(summary) === episode.contentHash ? 'fresh' : 'outdated'
}

export function isDriftedStoryEpisodeSyncStatus(status: StoryEpisodeSyncStatus) {
    return status === 'outdated' || status === 'source_empty'
}

export function attachEpisodeSyncStatus<
    T extends {
        sourceKind: string
        inactiveAt: Date | string | null
        contentHash: string
        sourceScene?: { summary: string | null } | null
    },
>(episode: T): T & { syncStatus: StoryEpisodeSyncStatus } {
    return {
        ...episode,
        syncStatus: storyEpisodeSyncStatus({
            sourceKind: episode.sourceKind,
            inactiveAt: episode.inactiveAt,
            contentHash: episode.contentHash,
            sourceSceneSummary: episode.sourceScene?.summary,
        }),
    }
}

function nonEmpty(value: string, field: string) {
    const normalized = value.normalize('NFKC').trim()
    if (!normalized) throw new Error(`${field} is required.`)
    return normalized
}

async function requireOwnedNovel(prisma: StoryDatabase, ownerId: string, novelId: string) {
    const novel = await prisma.novel.findFirst({
        where: { id: novelId, ownerId },
        select: { id: true },
    })
    if (!novel) throw new Error('Novel not found.')
    return novel
}

async function requireNovelMoment(prisma: StoryDatabase, novelId: string, momentId: string | null | undefined) {
    if (!momentId) return null
    const moment = await prisma.storyMoment.findFirst({
        where: { id: momentId, novelId },
        select: { id: true, storyOrder: true },
    })
    if (!moment) throw new Error(`Story moment ${momentId} was not found in this novel.`)
    return moment
}

async function requireNovelEntities(prisma: StoryDatabase, novelId: string, entityIds: string[]) {
    const uniqueIds = Array.from(new Set(entityIds.filter(Boolean)))
    if (uniqueIds.length === 0) return
    const count = await prisma.storyEntity.count({ where: { novelId, id: { in: uniqueIds } } })
    if (count !== uniqueIds.length) throw new Error('One or more story entities were not found in this novel.')
}

async function requireNovelFacts(prisma: StoryDatabase, novelId: string, factIds: string[]) {
    const uniqueIds = Array.from(new Set(factIds.filter(Boolean)))
    if (uniqueIds.length === 0) return new Map<string, { id: string; validFromMomentId: string | null }>()
    const facts = await prisma.storyFact.findMany({
        where: { novelId, id: { in: uniqueIds } },
        select: { id: true, validFromMomentId: true },
    })
    if (facts.length !== uniqueIds.length) throw new Error('One or more story facts were not found in this novel.')
    return new Map(facts.map((fact) => [fact.id, fact]))
}

export async function createStoryMoment(
    prisma: PrismaClient,
    input: {
        ownerId: string
        novelId: string
        label: string
        afterMomentId?: string | null
        sourceSceneId?: string | null
    }
) {
    const label = nonEmpty(input.label, 'label')
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)

    const moment = await prisma.$transaction(async (tx) => {
        const afterMoment = await requireNovelMoment(tx, input.novelId, input.afterMomentId)
        if (input.sourceSceneId) {
            const scene = await tx.scene.findFirst({
                where: { id: input.sourceSceneId, chapter: { novelId: input.novelId } },
                select: { id: true },
            })
            if (!scene) throw new Error('Source scene was not found in this novel.')
        }

        const storyOrder = afterMoment ? afterMoment.storyOrder + 1 : 0
        const momentCount = await tx.storyMoment.count({ where: { novelId: input.novelId } })
        const shift = momentCount + 1
        await tx.storyMoment.updateMany({
            where: { novelId: input.novelId, storyOrder: { gte: storyOrder } },
            data: { storyOrder: { increment: shift } },
        })
        await tx.storyMoment.updateMany({
            where: { novelId: input.novelId, storyOrder: { gte: storyOrder + shift } },
            data: { storyOrder: { decrement: shift - 1 } },
        })
        return tx.storyMoment.create({
            data: {
                novelId: input.novelId,
                label,
                storyOrder,
                sourceSceneId: input.sourceSceneId || null,
            },
        })
    })
    return moment
}

async function closeStoryOrderGap(tx: Prisma.TransactionClient, novelId: string, deletedOrder: number) {
    const momentCount = await tx.storyMoment.count({ where: { novelId } })
    const shift = momentCount + 1
    await tx.storyMoment.updateMany({
        where: { novelId, storyOrder: { gt: deletedOrder } },
        data: { storyOrder: { increment: shift } },
    })
    await tx.storyMoment.updateMany({
        where: { novelId, storyOrder: { gt: deletedOrder + shift } },
        data: { storyOrder: { decrement: shift + 1 } },
    })
}

export async function deleteStoryMoment(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string; momentId: string }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    return prisma.$transaction(async (tx) => {
        const moment = await tx.storyMoment.findFirst({
            where: { id: input.momentId, novelId: input.novelId },
            include: {
                _count: { select: { episodes: true, factsStarting: true, factsEnding: true } },
            },
        })
        if (!moment) throw new Error('Story moment not found.')
        const references = moment._count.episodes + moment._count.factsStarting + moment._count.factsEnding
        if (references > 0) {
            throw new Error('Story moment still has episode or fact references and cannot be deleted.')
        }
        await tx.storyMoment.delete({ where: { id: moment.id } })
        await closeStoryOrderGap(tx, input.novelId, moment.storyOrder)
        return { id: moment.id }
    })
}

export async function upsertStoryEntity(
    prisma: PrismaClient,
    input: {
        ownerId: string
        novelId: string
        entityId?: string | null
        name: string
        kind: StoryEntityKind
        summary?: string | null
        termId?: string | null
    }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    const name = nonEmpty(input.name, 'name')
    const normalizedName = normalizeStoryName(name)
    if (!normalizedName) throw new Error('name must contain searchable characters.')
    if (!STORY_ENTITY_KINDS.includes(input.kind)) throw new Error('Invalid story entity kind.')

    if (input.termId) {
        const termState = await prisma.novelTermState.findUnique({
            where: { novelId: input.novelId },
            select: { stateJson: true },
        })
        let state: unknown = null
        try {
            state = termState ? JSON.parse(termState.stateJson) : null
        } catch {
            state = null
        }
        const termExists = getTermStateEntries(state).some(
            (entry) => entry.id === input.termId && entry.archived !== true
        )
        if (!termExists) throw new Error('The selected term was not found in this novel.')
    }

    let entityId = input.entityId || null
    if (entityId) {
        const entity = await prisma.storyEntity.findFirst({
            where: { id: entityId, novelId: input.novelId },
            select: { id: true },
        })
        if (!entity) throw new Error('Story entity not found.')
    } else {
        const exactMatches = await prisma.storyEntity.findMany({
            where: { novelId: input.novelId, normalizedName },
            select: { id: true },
            take: 2,
        })
        if (exactMatches.length > 1) {
            throw new Error('Multiple entities have this normalized name. Pass entityId to select one.')
        }
        entityId = exactMatches[0]?.id ?? null
    }

    const data = {
        name,
        normalizedName,
        kind: input.kind,
        ...(input.summary !== undefined ? { summary: input.summary?.trim() || null } : {}),
        ...(input.termId !== undefined ? { termId: input.termId || null } : {}),
    }
    const entity = entityId
        ? await prisma.storyEntity.update({ where: { id: entityId }, data })
        : await prisma.storyEntity.create({ data: { novelId: input.novelId, ...data } })
    await syncNovelStoryRetrievalIndexes(prisma, input.novelId)
    return entity
}

export async function addStoryEntityAlias(
    prisma: PrismaClient,
    input: {
        ownerId: string
        novelId: string
        entityId: string
        alias: string
        sourceKind: StoryAliasSourceKind
    }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    await requireNovelEntities(prisma, input.novelId, [input.entityId])
    if (!STORY_ALIAS_SOURCE_KINDS.includes(input.sourceKind)) throw new Error('Invalid alias source kind.')
    const alias = nonEmpty(input.alias, 'alias')
    const normalizedAlias = normalizeStoryName(alias)
    if (!normalizedAlias) throw new Error('alias must contain searchable characters.')
    const result = await prisma.storyEntityAlias.upsert({
        where: { entityId_normalizedAlias: { entityId: input.entityId, normalizedAlias } },
        create: {
            novelId: input.novelId,
            entityId: input.entityId,
            alias,
            normalizedAlias,
            sourceKind: input.sourceKind,
        },
        update: { alias, sourceKind: input.sourceKind },
    })
    await syncNovelStoryRetrievalIndexes(prisma, input.novelId)
    return result
}

function storyFactIdentity(fact: {
    subjectEntityId: string
    predicateKey: string
    objectEntityId: string | null
    objectValue: string | null
    factText: string
    validFromMomentId: string | null
    validToMomentId: string | null
}) {
    return [
        fact.subjectEntityId,
        fact.predicateKey,
        fact.objectEntityId ?? '',
        fact.objectValue ?? '',
        fact.factText,
        fact.validFromMomentId ?? '',
        fact.validToMomentId ?? '',
    ].join('\0')
}

export async function mergeStoryEntities(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string; fromEntityId: string; intoEntityId: string }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    if (input.fromEntityId === input.intoEntityId) {
        throw new Error('Cannot merge an entity into itself.')
    }

    const entity = await prisma.$transaction(async (tx) => {
        const [from, into] = await Promise.all([
            tx.storyEntity.findFirst({
                where: { id: input.fromEntityId, novelId: input.novelId },
                include: { aliases: true },
            }),
            tx.storyEntity.findFirst({
                where: { id: input.intoEntityId, novelId: input.novelId },
                include: { aliases: { select: { normalizedAlias: true } } },
            }),
        ])
        if (!from || !into) throw new Error('Story entity not found.')

        const intoAliases = new Set(into.aliases.map((alias) => alias.normalizedAlias))
        for (const alias of from.aliases) {
            if (intoAliases.has(alias.normalizedAlias)) continue
            await tx.storyEntityAlias.update({
                where: { id: alias.id },
                data: { entityId: into.id },
            })
            intoAliases.add(alias.normalizedAlias)
        }

        await tx.storyFact.updateMany({
            where: { novelId: input.novelId, subjectEntityId: from.id },
            data: { subjectEntityId: into.id },
        })
        await tx.storyFact.updateMany({
            where: { novelId: input.novelId, objectEntityId: from.id },
            data: { objectEntityId: into.id },
        })

        const facts = await tx.storyFact.findMany({
            where: {
                novelId: input.novelId,
                OR: [{ subjectEntityId: into.id }, { objectEntityId: into.id }],
            },
            include: { evidence: true },
            orderBy: { createdAt: 'asc' },
        })
        const keeperByKey = new Map<string, (typeof facts)[number]>()
        for (const fact of facts) {
            const key = storyFactIdentity(fact)
            const keeper = keeperByKey.get(key)
            if (!keeper) {
                keeperByKey.set(key, fact)
                continue
            }
            for (const evidence of fact.evidence) {
                if (keeper.evidence.some((item) => item.episodeId === evidence.episodeId)) continue
                await tx.storyFactEvidence.create({
                    data: { factId: keeper.id, episodeId: evidence.episodeId, role: evidence.role },
                })
                keeper.evidence.push(evidence)
            }
            await tx.storyFact.delete({ where: { id: fact.id } })
        }

        await tx.storyEntity.delete({ where: { id: from.id } })
        return tx.storyEntity.findFirstOrThrow({
            where: { id: into.id },
            include: { aliases: { orderBy: { createdAt: 'asc' } } },
        })
    })
    await syncNovelStoryRetrievalIndexes(prisma, input.novelId)
    return entity
}

export async function deleteStoryEntity(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string; entityId: string }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    const entity = await prisma.storyEntity.findFirst({
        where: { id: input.entityId, novelId: input.novelId },
        include: { _count: { select: { subjectFacts: true, objectFacts: true } } },
    })
    if (!entity) throw new Error('Story entity not found.')
    if (entity.termId) throw new Error('Unbind the Term before deleting this entity.')
    if (entity._count.subjectFacts + entity._count.objectFacts > 0) {
        throw new Error('Story entity still has facts and cannot be deleted.')
    }
    await prisma.storyEntity.delete({ where: { id: entity.id } })
    await syncNovelStoryRetrievalIndexes(prisma, input.novelId)
    return { id: entity.id }
}

export async function deleteStoryEntityAlias(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string; aliasId: string }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    const alias = await prisma.storyEntityAlias.findFirst({
        where: { id: input.aliasId, novelId: input.novelId },
        select: { id: true },
    })
    if (!alias) throw new Error('Story entity alias not found.')
    await prisma.storyEntityAlias.delete({ where: { id: alias.id } })
    await syncNovelStoryRetrievalIndexes(prisma, input.novelId)
    return { id: alias.id }
}

async function validateEpisodePlan(tx: Prisma.TransactionClient, input: ApplyEpisodeInput) {
    const referenceMoment = await requireNovelMoment(tx, input.novelId, input.referenceMomentId)
    const newFacts = input.facts.filter((fact): fact is Exclude<StoryFactAssertion, { factId: string }> => !('factId' in fact))
    const existingFactIds = input.facts.flatMap((fact) => 'factId' in fact ? [fact.factId] : [])
    const closureIds = (input.closeFacts ?? []).map((closure) => closure.factId)
    const invalidateIds = input.invalidateFactIds ?? []
    const existingFacts = await requireNovelFacts(tx, input.novelId, [
        ...existingFactIds,
        ...closureIds,
        ...invalidateIds,
    ])
    await requireNovelEntities(tx, input.novelId, newFacts.flatMap((fact) => [
        fact.subjectEntityId,
        ...(fact.objectEntityId ? [fact.objectEntityId] : []),
    ]))

    const supportIds = new Set(existingFactIds)
    if (invalidateIds.some((factId) => supportIds.has(factId))) {
        throw new Error('The same episode cannot support and invalidate one fact.')
    }

    const momentIds = new Set<string>()
    for (const fact of newFacts) {
        const predicateKey = nonEmpty(fact.predicateKey, 'predicateKey').toLocaleUpperCase()
        if (!/^[A-Z][A-Z0-9_]*$/.test(predicateKey)) {
            throw new Error('predicateKey must use uppercase letters, numbers, and underscores.')
        }
        nonEmpty(fact.factText, 'factText')
        const hasObjectEntity = Boolean(fact.objectEntityId)
        const hasObjectValue = Boolean(fact.objectValue?.trim())
        if (hasObjectEntity === hasObjectValue) {
            throw new Error('Each story fact must provide exactly one of objectEntityId or objectValue.')
        }
        if (fact.validFromMomentId) momentIds.add(fact.validFromMomentId)
        if (fact.validToMomentId) momentIds.add(fact.validToMomentId)
    }
    for (const closure of input.closeFacts ?? []) momentIds.add(closure.validToMomentId)
    for (const closure of input.closeFacts ?? []) {
        const validFromMomentId = existingFacts.get(closure.factId)?.validFromMomentId
        if (validFromMomentId) momentIds.add(validFromMomentId)
    }

    const moments = momentIds.size > 0
        ? await tx.storyMoment.findMany({
              where: { novelId: input.novelId, id: { in: Array.from(momentIds) } },
              select: { id: true, storyOrder: true },
          })
        : []
    if (moments.length !== momentIds.size) throw new Error('One or more story moments were not found in this novel.')
    const orderByMomentId = new Map(moments.map((moment) => [moment.id, moment.storyOrder]))
    for (const fact of newFacts) {
        const fromOrder = fact.validFromMomentId ? orderByMomentId.get(fact.validFromMomentId) : null
        const toOrder = fact.validToMomentId ? orderByMomentId.get(fact.validToMomentId) : null
        if (fromOrder !== null && fromOrder !== undefined && toOrder !== null && toOrder !== undefined && fromOrder >= toOrder) {
            throw new Error('Fact validToMomentId must come after validFromMomentId.')
        }
    }
    for (const closure of input.closeFacts ?? []) {
        const validFromMomentId = existingFacts.get(closure.factId)?.validFromMomentId
        const fromOrder = validFromMomentId ? orderByMomentId.get(validFromMomentId) : null
        const toOrder = orderByMomentId.get(closure.validToMomentId)
        if (fromOrder !== null && fromOrder !== undefined && toOrder !== undefined && fromOrder >= toOrder) {
            throw new Error('A closed fact must end after its validFromMomentId.')
        }
    }
    return { referenceMoment }
}

async function createOrReuseFact(
    tx: Prisma.TransactionClient,
    novelId: string,
    assertion: Exclude<StoryFactAssertion, { factId: string }>
) {
    const predicateKey = assertion.predicateKey.normalize('NFKC').trim().toLocaleUpperCase()
    const factText = assertion.factText.normalize('NFKC').trim()
    const objectEntityId = assertion.objectEntityId || null
    const objectValue = assertion.objectValue?.normalize('NFKC').trim() || null
    const validFromMomentId = assertion.validFromMomentId || null
    const validToMomentId = assertion.validToMomentId || null
    const existing = await tx.storyFact.findFirst({
        where: {
            novelId,
            subjectEntityId: assertion.subjectEntityId,
            predicateKey,
            objectEntityId,
            objectValue,
            factText,
            validFromMomentId,
            validToMomentId,
        },
    })
    if (existing) return existing
    return tx.storyFact.create({
        data: {
            novelId,
            subjectEntityId: assertion.subjectEntityId,
            predicateKey,
            objectEntityId,
            objectValue,
            factText,
            validFromMomentId,
            validToMomentId,
        },
    })
}

async function applyStoryEpisode(prisma: PrismaClient, input: ApplyEpisodeInput) {
    const content = nonEmpty(input.content, 'content')
    const contentHash = hashStoryContent(content)

    const result = await prisma.$transaction(async (tx) => {
        await validateEpisodePlan(tx, input)
        const currentEpisode = input.sourceKind === 'SCENE_SUMMARY' && input.sourceSceneId
            ? await tx.storyEpisode.findFirst({
                  where: {
                      novelId: input.novelId,
                      sourceKind: 'SCENE_SUMMARY',
                      sourceSceneId: input.sourceSceneId,
                      inactiveAt: null,
                  },
              })
            : null
        if (currentEpisode?.contentHash === contentHash) {
            return { episode: currentEpisode, factIds: [] as string[], skipped: true }
        }

        if (currentEpisode) {
            await tx.storyEpisode.update({
                where: { id: currentEpisode.id },
                data: { inactiveAt: new Date(), inactiveReason: 'SUPERSEDED' },
            })
        }
        const episode = await tx.storyEpisode.create({
            data: {
                novelId: input.novelId,
                sourceKind: input.sourceKind,
                sourceSceneId: input.sourceSceneId || null,
                content,
                contentHash,
                referenceMomentId: input.referenceMomentId || null,
                replacesEpisodeId: currentEpisode?.id ?? null,
            },
        })

        const factIds: string[] = []
        for (const assertion of input.facts) {
            const fact = 'factId' in assertion
                ? await tx.storyFact.findUniqueOrThrow({ where: { id: assertion.factId } })
                : await createOrReuseFact(tx, input.novelId, assertion)
            await tx.storyFactEvidence.create({
                data: { factId: fact.id, episodeId: episode.id, role: 'SUPPORTS' },
            })
            factIds.push(fact.id)
        }
        for (const closure of input.closeFacts ?? []) {
            await tx.storyFact.update({
                where: { id: closure.factId },
                data: { validToMomentId: closure.validToMomentId },
            })
        }
        for (const factId of input.invalidateFactIds ?? []) {
            await tx.storyFactEvidence.create({
                data: { factId, episodeId: episode.id, role: 'INVALIDATES' },
            })
        }
        return { episode, factIds, skipped: false }
    })
    await syncNovelStoryRetrievalIndexes(prisma, input.novelId)
    return result
}

export async function syncSceneStoryEpisode(
    prisma: PrismaClient,
    input: {
        ownerId: string
        novelId: string
        sceneId: string
        referenceMomentId?: string | null
        facts: StoryFactAssertion[]
        closeFacts?: StoryFactClosure[]
        invalidateFactIds?: string[]
    }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    const scene = await prisma.scene.findFirst({
        where: { id: input.sceneId, chapter: { novelId: input.novelId } },
        select: { id: true, summary: true },
    })
    if (!scene) throw new Error('Scene not found.')
    if (!scene.summary?.trim()) throw new Error('The scene has no summary to sync.')
    return applyStoryEpisode(prisma, {
        novelId: input.novelId,
        sourceKind: 'SCENE_SUMMARY',
        sourceSceneId: scene.id,
        content: scene.summary,
        referenceMomentId: input.referenceMomentId,
        facts: input.facts,
        closeFacts: input.closeFacts,
        invalidateFactIds: input.invalidateFactIds,
    })
}

export async function assertManualStoryEpisode(
    prisma: PrismaClient,
    input: {
        ownerId: string
        novelId: string
        content: string
        referenceMomentId?: string | null
        facts: StoryFactAssertion[]
        closeFacts?: StoryFactClosure[]
        invalidateFactIds?: string[]
    }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    return applyStoryEpisode(prisma, {
        novelId: input.novelId,
        sourceKind: 'MANUAL',
        content: input.content,
        referenceMomentId: input.referenceMomentId,
        facts: input.facts,
        closeFacts: input.closeFacts,
        invalidateFactIds: input.invalidateFactIds,
    })
}

export async function retractManualStoryEpisode(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string; episodeId: string }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    const episode = await prisma.storyEpisode.findFirst({
        where: { id: input.episodeId, novelId: input.novelId, sourceKind: 'MANUAL', inactiveAt: null },
    })
    if (!episode) throw new Error('Active manual story episode not found.')
    const updated = await prisma.storyEpisode.update({
        where: { id: episode.id },
        data: { inactiveAt: new Date(), inactiveReason: 'MANUAL_RETRACTED' },
    })
    await syncNovelStoryRetrievalIndexes(prisma, input.novelId)
    return updated
}

export async function deactivateStoryEpisodesForScene(tx: Prisma.TransactionClient, sceneId: string) {
    await storyStateLifecycle.deactivateStoryEpisodesForScene(tx, sceneId)
}

export function isCredibleStoryFact(fact: {
    evidence: Array<{ role: string; episode: { inactiveAt: Date | string | null } }>
}) {
    let supported = false
    for (const evidence of fact.evidence) {
        if (evidence.episode.inactiveAt) continue
        if (evidence.role === 'INVALIDATES') return false
        if (evidence.role === 'SUPPORTS') supported = true
    }
    return supported
}

export function isStaleCredibleStoryFact(fact: {
    evidence: Array<{
        role: string
        episode: { inactiveAt: Date | string | null; syncStatus?: StoryEpisodeSyncStatus }
    }>
}) {
    if (!isCredibleStoryFact(fact)) return false
    const activeSupports = fact.evidence.filter(
        (evidence) => !evidence.episode.inactiveAt && evidence.role === 'SUPPORTS'
    )
    return (
        activeSupports.length > 0
        && activeSupports.every((evidence) =>
            evidence.episode.syncStatus
                ? isDriftedStoryEpisodeSyncStatus(evidence.episode.syncStatus)
                : false
        )
    )
}

export function annotateStoryFactCredibility<
    T extends {
        evidence: Array<{
            role: string
            episode: {
                sourceKind: string
                inactiveAt: Date | string | null
                contentHash: string
                sourceScene?: { summary: string | null } | null
            }
        }>
    },
>(fact: T) {
    const evidence = fact.evidence.map((item) => ({
        ...item,
        episode: attachEpisodeSyncStatus(item.episode),
    }))
    const annotated = { ...fact, evidence }
    return {
        ...annotated,
        credible: isCredibleStoryFact(annotated),
        staleCredible: isStaleCredibleStoryFact(annotated),
    }
}

const episodeSyncSelect = {
    id: true,
    sourceKind: true,
    sourceSceneId: true,
    contentHash: true,
    inactiveAt: true,
    inactiveReason: true,
    sourceScene: { select: { summary: true } },
} as const

export async function listOutdatedStoryEpisodes(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    const episodes = await prisma.storyEpisode.findMany({
        where: { novelId: input.novelId, sourceKind: 'SCENE_SUMMARY', inactiveAt: null },
        select: {
            ...episodeSyncSelect,
            content: true,
            referenceMomentId: true,
            createdAt: true,
            sourceScene: {
                select: {
                    id: true,
                    summary: true,
                    chapter: { select: { id: true, title: true } },
                },
            },
            referenceMoment: { select: { id: true, label: true, storyOrder: true } },
            _count: { select: { evidence: true } },
        },
        orderBy: { createdAt: 'desc' },
    })
    return episodes
        .map(attachEpisodeSyncStatus)
        .filter((episode) => isDriftedStoryEpisodeSyncStatus(episode.syncStatus))
}

export async function queryCredibleStoryFacts(
    prisma: PrismaClient,
    input: {
        ownerId: string
        novelId: string
        entityId?: string | null
        predicateKey?: string | null
        targetMomentId?: string | null
        includeHistory?: boolean
    }
) {
    await requireOwnedNovel(prisma, input.ownerId, input.novelId)
    const targetMoment = await requireNovelMoment(prisma, input.novelId, input.targetMomentId)
    const facts = await prisma.storyFact.findMany({
        where: {
            novelId: input.novelId,
            ...(input.entityId
                ? { OR: [{ subjectEntityId: input.entityId }, { objectEntityId: input.entityId }] }
                : {}),
            ...(input.predicateKey ? { predicateKey: input.predicateKey.trim().toLocaleUpperCase() } : {}),
        },
        include: {
            subjectEntity: { select: { id: true, name: true, kind: true } },
            objectEntity: { select: { id: true, name: true, kind: true } },
            validFromMoment: { select: { id: true, label: true, storyOrder: true } },
            validToMoment: { select: { id: true, label: true, storyOrder: true } },
            evidence: {
                include: {
                    episode: { select: episodeSyncSelect },
                },
            },
        },
        orderBy: { createdAt: 'desc' },
    })

    return facts
        .map(annotateStoryFactCredibility)
        .filter((fact) => {
            if (!input.includeHistory && !fact.credible) return false
            if (!targetMoment) return true
            if (fact.validFromMoment && fact.validFromMoment.storyOrder > targetMoment.storyOrder) return false
            if (fact.validToMoment && fact.validToMoment.storyOrder <= targetMoment.storyOrder) return false
            return true
        })
}
