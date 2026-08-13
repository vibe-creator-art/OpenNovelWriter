import type { PrismaClient } from '@/generated/prisma/client'
import {
    getRetrievalCandidateLimit,
    rankBm25,
    rankVectors,
    reciprocalRankFusion,
    type RankedItem,
} from '@/lib/server/retrieval-algorithms'
import { normalizeRetrievalTopK } from '@/lib/server/hybrid-retrieval'
import {
    createEmbeddingsWithGroup,
    loadRetrievalGroup,
    rerankDocumentsWithGroup,
} from '@/lib/server/retrieval-models'
import { isCredibleStoryFact } from '@/lib/server/story-state'
import { syncNovelStoryRetrievalIndexes } from '@/lib/server/story-retrieval-index'

const EMBEDDING_BATCH_SIZE = 32
const MAX_MODEL_CHARACTERS = 32_000
const EXCERPT_CHARACTERS = 800

function parseVector(value: string | null) {
    if (!value) return null
    try {
        const parsed = JSON.parse(value) as unknown
        if (!Array.isArray(parsed) || parsed.length === 0) return null
        if (parsed.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return null
        return parsed as number[]
    } catch {
        return null
    }
}

function prepareModelText(value: string) {
    return value.length <= MAX_MODEL_CHARACTERS ? value : value.slice(0, MAX_MODEL_CHARACTERS)
}

function excerpt(value: string) {
    return value.length <= EXCERPT_CHARACTERS ? value : `${value.slice(0, EXCERPT_CHARACTERS)}…`
}

function scoreById(ranking: RankedItem[]) {
    return new Map(ranking.map((item) => [item.id, item.score]))
}

export async function updateNovelStoryEmbeddings(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string; signal?: AbortSignal }
) {
    const novel = await prisma.novel.findFirst({
        where: { id: input.novelId, ownerId: input.ownerId },
        select: { id: true, retrievalEmbeddingEnabled: true, retrievalEmbeddingGroupId: true },
    })
    if (!novel) throw new Error('Novel not found.')
    if (!novel.retrievalEmbeddingEnabled || !novel.retrievalEmbeddingGroupId) {
        throw new Error('Embedding retrieval is not enabled for this novel.')
    }
    const group = await loadRetrievalGroup(prisma, {
        ownerId: input.ownerId,
        groupId: novel.retrievalEmbeddingGroupId,
        capability: 'embedding',
    })
    await syncNovelStoryRetrievalIndexes(prisma, novel.id)
    const indexes = await prisma.storyRetrievalIndex.findMany({
        where: { novelId: novel.id },
        orderBy: { id: 'asc' },
    })
    const indexesToUpdate = indexes.filter((index) =>
        !index.embeddingJson
        || index.embeddingHash !== index.contentHash
        || index.embeddingGroupId !== group.groupId
        || Boolean(index.embeddingError)
    )

    let updated = 0
    let lastAssignment: { assignmentId: string; modelId: string } | null = null
    for (let offset = 0; offset < indexesToUpdate.length; offset += EMBEDDING_BATCH_SIZE) {
        const batch = indexesToUpdate.slice(offset, offset + EMBEDDING_BATCH_SIZE)
        try {
            const { vectors, assignment } = await createEmbeddingsWithGroup(
                prisma,
                group,
                batch.map((index) => prepareModelText(index.searchText)),
                input.signal
            )
            lastAssignment = assignment
            await prisma.$transaction(batch.map((index, batchIndex) => {
                const vector = vectors[batchIndex]
                return prisma.storyRetrievalIndex.update({
                    where: { id: index.id },
                    data: {
                        embeddingJson: JSON.stringify(vector),
                        embeddingHash: index.contentHash,
                        embeddingGroupId: group.groupId,
                        embeddingAssignmentId: assignment.assignmentId,
                        embeddingModelId: assignment.modelId,
                        embeddingDimensions: vector.length,
                        embeddingError: null,
                        embeddingUpdatedAt: new Date(),
                    },
                })
            }))
            updated += batch.length
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Embedding update failed.'
            await prisma.storyRetrievalIndex.updateMany({
                where: { id: { in: batch.map((index) => index.id) } },
                data: { embeddingError: message },
            })
            throw error
        }
    }
    return {
        updated,
        skipped: indexes.length - indexesToUpdate.length,
        groupId: group.groupId,
        assignmentId: lastAssignment?.assignmentId ?? null,
        modelId: lastAssignment?.modelId ?? null,
    }
}

export async function searchNovelStoryGraph(
    prisma: PrismaClient,
    input: {
        ownerId: string
        novelId: string
        query: string
        topK?: number
        targetMomentId?: string | null
        afterMomentId?: string | null
        includeHistory?: boolean
        signal?: AbortSignal
    }
) {
    const query = input.query.trim()
    if (!query) throw new Error('Query is required.')
    const novel = await prisma.novel.findFirst({
        where: { id: input.novelId, ownerId: input.ownerId },
        select: {
            id: true,
            retrievalTopK: true,
            retrievalEmbeddingEnabled: true,
            retrievalEmbeddingGroupId: true,
            retrievalRerankerEnabled: true,
            retrievalRerankerGroupId: true,
        },
    })
    if (!novel) throw new Error('Novel not found.')

    const momentIds = [input.targetMomentId, input.afterMomentId].filter(Boolean) as string[]
    const moments = momentIds.length > 0
        ? await prisma.storyMoment.findMany({
              where: { novelId: novel.id, id: { in: momentIds } },
              select: { id: true, storyOrder: true },
          })
        : []
    if (moments.length !== new Set(momentIds).size) throw new Error('Story moment not found.')
    const orderByMomentId = new Map(moments.map((moment) => [moment.id, moment.storyOrder]))
    const targetOrder = input.targetMomentId ? orderByMomentId.get(input.targetMomentId) ?? null : null
    const afterOrder = input.afterMomentId ? orderByMomentId.get(input.afterMomentId) ?? null : null

    await syncNovelStoryRetrievalIndexes(prisma, novel.id)
    const [indexes, entities, facts, episodes] = await Promise.all([
        prisma.storyRetrievalIndex.findMany({ where: { novelId: novel.id, searchText: { not: '' } } }),
        prisma.storyEntity.findMany({
            where: { novelId: novel.id },
            include: { aliases: { orderBy: { createdAt: 'asc' } } },
        }),
        prisma.storyFact.findMany({
            where: { novelId: novel.id },
            include: {
                subjectEntity: { select: { id: true, name: true, kind: true } },
                objectEntity: { select: { id: true, name: true, kind: true } },
                validFromMoment: { select: { id: true, label: true, storyOrder: true } },
                validToMoment: { select: { id: true, label: true, storyOrder: true } },
                evidence: {
                    include: {
                        episode: {
                            select: {
                                id: true,
                                sourceKind: true,
                                sourceSceneId: true,
                                inactiveAt: true,
                                inactiveReason: true,
                            },
                        },
                    },
                },
            },
        }),
        prisma.storyEpisode.findMany({
            where: { novelId: novel.id },
            include: {
                referenceMoment: { select: { id: true, label: true, storyOrder: true } },
                sourceScene: {
                    select: { id: true, chapter: { select: { id: true, title: true } } },
                },
                evidence: { select: { factId: true, role: true } },
            },
        }),
    ])

    const entitiesById = new Map(entities.map((entity) => [entity.id, entity]))
    const factsById = new Map(facts.map((fact) => [fact.id, fact]))
    const episodesById = new Map(episodes.map((episode) => [episode.id, episode]))
    const factAllowed = (fact: (typeof facts)[number]) => {
        if (!input.includeHistory && !isCredibleStoryFact(fact)) return false
        if (targetOrder !== null) {
            if (fact.validFromMoment && fact.validFromMoment.storyOrder > targetOrder) return false
            if (fact.validToMoment && fact.validToMoment.storyOrder <= targetOrder) return false
        }
        if (afterOrder !== null) {
            if (!fact.validFromMoment || fact.validFromMoment.storyOrder <= afterOrder) return false
        }
        return true
    }
    const episodeAllowed = (episode: (typeof episodes)[number]) => {
        if (!input.includeHistory && episode.inactiveAt) return false
        if (targetOrder !== null && episode.referenceMoment && episode.referenceMoment.storyOrder > targetOrder) return false
        if (afterOrder !== null) {
            if (!episode.referenceMoment || episode.referenceMoment.storyOrder <= afterOrder) return false
        }
        return true
    }
    const allowedIndexes = indexes.filter((index) => {
        if (index.sourceKind === 'FACT') {
            const fact = factsById.get(index.sourceId)
            return Boolean(fact && factAllowed(fact))
        }
        if (index.sourceKind === 'EPISODE') {
            const episode = episodesById.get(index.sourceId)
            return Boolean(episode && episodeAllowed(episode))
        }
        return entitiesById.has(index.sourceId)
    })
    const indexById = new Map(allowedIndexes.map((index) => [index.id, index]))
    const indexIdBySource = new Map(
        allowedIndexes.map((index) => [`${index.sourceKind}:${index.sourceId}`, index.id])
    )
    const topK = normalizeRetrievalTopK(input.topK, novel.retrievalTopK)
    const candidateLimit = getRetrievalCandidateLimit(topK)
    const bm25Ranking = rankBm25(
        query,
        allowedIndexes.map((index) => ({ id: index.id, text: index.searchText })),
        candidateLimit
    )
    let vectorRanking: RankedItem[] = []
    const warnings: string[] = []

    if (novel.retrievalEmbeddingEnabled && novel.retrievalEmbeddingGroupId) {
        try {
            const group = await loadRetrievalGroup(prisma, {
                ownerId: input.ownerId,
                groupId: novel.retrievalEmbeddingGroupId,
                capability: 'embedding',
            })
            const vectorDocuments = allowedIndexes.flatMap((index) => {
                if (index.embeddingGroupId !== group.groupId) return []
                const vector = parseVector(index.embeddingJson)
                return vector ? [{ id: index.id, vector }] : []
            })
            if (vectorDocuments.length > 0) {
                const { vectors } = await createEmbeddingsWithGroup(
                    prisma,
                    group,
                    [prepareModelText(query)],
                    input.signal
                )
                vectorRanking = rankVectors(vectors[0], vectorDocuments, candidateLimit)
            }
        } catch (error) {
            warnings.push(`Story graph embedding retrieval was skipped: ${error instanceof Error ? error.message : 'provider error'}`)
        }
    }

    const initialRanking = vectorRanking.length > 0
        ? reciprocalRankFusion([bm25Ranking, vectorRanking], candidateLimit)
        : bm25Ranking.slice(0, candidateLimit)
    const neighborIds: string[] = []
    const seenNeighbors = new Set<string>()
    const addNeighbor = (sourceKind: string, sourceId: string) => {
        const indexId = indexIdBySource.get(`${sourceKind}:${sourceId}`)
        if (!indexId || seenNeighbors.has(indexId)) return
        seenNeighbors.add(indexId)
        neighborIds.push(indexId)
    }
    for (const item of initialRanking.slice(0, Math.min(20, initialRanking.length))) {
        const index = indexById.get(item.id)
        if (!index) continue
        if (index.sourceKind === 'ENTITY') {
            for (const fact of facts) {
                if (!factAllowed(fact)) continue
                if (fact.subjectEntityId === index.sourceId || fact.objectEntityId === index.sourceId) {
                    addNeighbor('FACT', fact.id)
                }
            }
        } else if (index.sourceKind === 'FACT') {
            const fact = factsById.get(index.sourceId)
            if (!fact) continue
            addNeighbor('ENTITY', fact.subjectEntityId)
            if (fact.objectEntityId) addNeighbor('ENTITY', fact.objectEntityId)
            for (const evidence of fact.evidence) addNeighbor('EPISODE', evidence.episode.id)
        } else if (index.sourceKind === 'EPISODE') {
            const episode = episodesById.get(index.sourceId)
            if (!episode) continue
            for (const evidence of episode.evidence) addNeighbor('FACT', evidence.factId)
        }
    }
    const graphRanking = neighborIds.slice(0, candidateLimit).map((id, index) => ({
        id,
        rank: index + 1,
        score: 1 / (index + 1),
    }))
    const fusedRanking = graphRanking.length > 0
        ? reciprocalRankFusion([bm25Ranking, vectorRanking, graphRanking].filter((ranking) => ranking.length > 0), candidateLimit)
        : initialRanking
    let finalRanking = fusedRanking
    const rerankerScores = new Map<string, number>()
    let rerankerUsed = false

    if (novel.retrievalRerankerEnabled && novel.retrievalRerankerGroupId && fusedRanking.length > 0) {
        try {
            const group = await loadRetrievalGroup(prisma, {
                ownerId: input.ownerId,
                groupId: novel.retrievalRerankerGroupId,
                capability: 'reranker',
            })
            const candidates = fusedRanking
                .map((item) => indexById.get(item.id))
                .filter((index): index is NonNullable<typeof index> => Boolean(index))
            const { results } = await rerankDocumentsWithGroup(prisma, group, {
                query,
                documents: candidates.map((index) => prepareModelText(index.searchText)),
                topN: candidates.length,
            }, input.signal)
            const rerankedIds = results.map((result) => candidates[result.index]?.id).filter(Boolean) as string[]
            results.forEach((result) => {
                const id = candidates[result.index]?.id
                if (id) rerankerScores.set(id, result.score)
            })
            const returned = new Set(rerankedIds)
            const remainingIds = fusedRanking.map((item) => item.id).filter((id) => !returned.has(id))
            const fusionScores = scoreById(fusedRanking)
            finalRanking = [...rerankedIds, ...remainingIds].map((id, index) => ({
                id,
                rank: index + 1,
                score: rerankerScores.get(id) ?? fusionScores.get(id) ?? 0,
            }))
            rerankerUsed = rerankedIds.length > 0
        } catch (error) {
            warnings.push(`Story graph reranking was skipped: ${error instanceof Error ? error.message : 'provider error'}`)
        }
    }

    const bm25Scores = scoreById(bm25Ranking)
    const vectorScores = scoreById(vectorRanking)
    const graphScores = scoreById(graphRanking)
    const fusionScores = scoreById(fusedRanking)
    const results: Array<Record<string, unknown>> = []
    for (const item of finalRanking.slice(0, topK)) {
        const index = indexById.get(item.id)
        if (!index) continue
        const common = {
            sourceKind: index.sourceKind,
            sourceId: index.sourceId,
            excerpt: excerpt(index.searchText),
            embeddingStatus: novel.retrievalEmbeddingEnabled
                && index.embeddingGroupId === novel.retrievalEmbeddingGroupId
                && index.embeddingJson
                ? index.embeddingHash === index.contentHash ? 'fresh' : 'stale'
                : 'missing',
            scores: {
                bm25: bm25Scores.get(index.id) ?? null,
                vector: vectorScores.get(index.id) ?? null,
                graph: graphScores.get(index.id) ?? null,
                fusion: fusionScores.get(index.id) ?? null,
                reranker: rerankerScores.get(index.id) ?? null,
            },
        }
        if (index.sourceKind === 'ENTITY') {
            const entity = entitiesById.get(index.sourceId)
            if (entity) results.push({ ...common, entity })
            continue
        }
        if (index.sourceKind === 'FACT') {
            const fact = factsById.get(index.sourceId)
            if (fact) results.push({ ...common, fact: { ...fact, credible: isCredibleStoryFact(fact) } })
            continue
        }
        const episode = episodesById.get(index.sourceId)
        if (episode) results.push({ ...common, episode })
    }

    return {
        query,
        topK,
        candidateLimit,
        filters: {
            targetMomentId: input.targetMomentId ?? null,
            afterMomentId: input.afterMomentId ?? null,
            includeHistory: input.includeHistory === true,
        },
        modes: {
            bm25: true,
            embedding: novel.retrievalEmbeddingEnabled,
            graphExpansion: true,
            reranker: novel.retrievalRerankerEnabled,
            embeddingUsed: vectorRanking.length > 0,
            rerankerUsed,
        },
        warnings,
        results,
    }
}
