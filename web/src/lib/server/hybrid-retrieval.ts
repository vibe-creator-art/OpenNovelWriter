import type { PrismaClient } from '@/generated/prisma/client'
import {
    getRetrievalCandidateLimit,
    rankBm25,
    rankVectors,
    reciprocalRankFusion,
    type RankedItem,
} from '@/lib/server/retrieval-algorithms'
import {
    createEmbeddingsWithGroup,
    loadRetrievalGroup,
    rerankDocumentsWithGroup,
} from '@/lib/server/retrieval-models'
import { syncNovelSceneRetrievalIndexes } from '@/lib/server/scene-retrieval-index'
import {
    syncNovelStoryRetrievalIndexes,
    type StoryRetrievalSourceKind,
} from '@/lib/server/story-retrieval-index'

const DEFAULT_TOP_K = 10
const MIN_TOP_K = 1
const MAX_TOP_K = 50
const EMBEDDING_BATCH_SIZE = 32
const MAX_EMBEDDING_CHARACTERS = 32_000
const MAX_RERANK_CHARACTERS = 32_000
const EXCERPT_CHARACTERS = 1_200

export type SceneEmbeddingStatus = 'fresh' | 'stale' | 'missing' | 'error'

export type SceneRetrievalStatus = {
    sceneId: string
    status: SceneEmbeddingStatus
    embeddedAt: string | null
    error: string | null
}

export type HybridSceneSearchResult = {
    sceneId: string
    chapterId: string
    chapterTitle: string
    chapterOrder: number
    actNumber: number
    sceneOrder: number
    excerpt: string
    embeddingStatus: SceneEmbeddingStatus
    scores: {
        bm25: number | null
        vector: number | null
        fusion: number | null
        reranker: number | null
    }
}

export function normalizeRetrievalTopK(value: unknown, fallback = DEFAULT_TOP_K) {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isInteger(parsed)) return fallback
    return Math.max(MIN_TOP_K, Math.min(MAX_TOP_K, parsed))
}

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

function getEmbeddingStatus(
    index: {
        contentHash: string
        embeddingHash: string | null
        embeddingJson: string | null
        embeddingGroupId: string | null
        embeddingError: string | null
    },
    expectedGroupId: string | null
): SceneEmbeddingStatus {
    if (
        expectedGroupId
        && index.embeddingError
        && index.embeddingGroupId === expectedGroupId
    ) return 'error'
    if (
        !expectedGroupId
        || !index.embeddingJson
        || index.embeddingGroupId !== expectedGroupId
    ) {
        return 'missing'
    }
    return index.embeddingHash === index.contentHash ? 'fresh' : 'stale'
}

function prepareModelText(text: string, maxCharacters: number) {
    return text.length <= maxCharacters ? text : text.slice(0, maxCharacters)
}

function buildExcerpt(text: string, query: string) {
    if (text.length <= EXCERPT_CHARACTERS) return text
    const normalizedText = text.toLocaleLowerCase()
    const normalizedQuery = query.trim().toLocaleLowerCase()
    let matchIndex = normalizedQuery ? normalizedText.indexOf(normalizedQuery) : -1
    if (matchIndex < 0) {
        const terms = normalizedQuery.match(/[\p{L}\p{N}]{2,}/gu) ?? []
        for (const term of terms) {
            matchIndex = normalizedText.indexOf(term)
            if (matchIndex >= 0) break
        }
    }
    if (matchIndex < 0) matchIndex = 0
    const start = Math.max(0, Math.min(text.length - EXCERPT_CHARACTERS, matchIndex - 240))
    const excerpt = text.slice(start, start + EXCERPT_CHARACTERS)
    return `${start > 0 ? '…' : ''}${excerpt}${start + EXCERPT_CHARACTERS < text.length ? '…' : ''}`
}

export async function getNovelRetrievalStatus(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string }
) {
    const novel = await prisma.novel.findFirst({
        where: { id: input.novelId, ownerId: input.ownerId },
        select: {
            id: true,
            retrievalEmbeddingEnabled: true,
            retrievalEmbeddingGroupId: true,
        },
    })
    if (!novel) throw new Error('Novel not found.')

    await Promise.all([
        syncNovelSceneRetrievalIndexes(prisma, novel.id),
        syncNovelStoryRetrievalIndexes(prisma, novel.id),
    ])
    const [indexes, storyIndexes] = await Promise.all([
        prisma.sceneRetrievalIndex.findMany({
            where: { novelId: novel.id },
            select: {
                sceneId: true,
                contentHash: true,
                embeddingHash: true,
                embeddingJson: true,
                embeddingGroupId: true,
                embeddingError: true,
                embeddingUpdatedAt: true,
            },
        }),
        prisma.storyRetrievalIndex.findMany({
            where: { novelId: novel.id },
            select: {
                sourceKind: true,
                contentHash: true,
                embeddingHash: true,
                embeddingJson: true,
                embeddingGroupId: true,
                embeddingError: true,
            },
        }),
    ])
    const expectedGroupId = novel.retrievalEmbeddingEnabled ? novel.retrievalEmbeddingGroupId : null
    const statuses: SceneRetrievalStatus[] = indexes.map((index) => {
        const status = getEmbeddingStatus(index, expectedGroupId)
        return {
            sceneId: index.sceneId,
            status,
            embeddedAt: index.embeddingUpdatedAt?.toISOString() ?? null,
            error: status === 'error' ? index.embeddingError ?? null : null,
        }
    })
    const counts: Record<SceneEmbeddingStatus, number> = { fresh: 0, stale: 0, missing: 0, error: 0 }
    statuses.forEach((item) => { counts[item.status] += 1 })
    const emptyCounts = (): Record<SceneEmbeddingStatus, number> => ({ fresh: 0, stale: 0, missing: 0, error: 0 })
    const storyStateCounts: Record<StoryRetrievalSourceKind, Record<SceneEmbeddingStatus, number>> = {
        ENTITY: emptyCounts(),
        FACT: emptyCounts(),
        EPISODE: emptyCounts(),
    }
    storyIndexes.forEach((index) => {
        const sourceCounts = storyStateCounts[index.sourceKind as StoryRetrievalSourceKind]
        if (!sourceCounts) return
        sourceCounts[getEmbeddingStatus(index, expectedGroupId)] += 1
    })

    return {
        embeddingEnabled: novel.retrievalEmbeddingEnabled,
        cachedCount: indexes.filter((index) => Boolean(index.embeddingJson)).length,
        statuses,
        counts,
        storyStateCounts,
    }
}

export async function updateNovelSceneEmbeddings(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string; sceneId?: string | null; signal?: AbortSignal }
) {
    const novel = await prisma.novel.findFirst({
        where: { id: input.novelId, ownerId: input.ownerId },
        select: {
            id: true,
            retrievalEmbeddingEnabled: true,
            retrievalEmbeddingGroupId: true,
        },
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
    await syncNovelSceneRetrievalIndexes(prisma, novel.id)

    const indexes = await prisma.sceneRetrievalIndex.findMany({
        where: {
            novelId: novel.id,
            ...(input.sceneId ? { sceneId: input.sceneId } : {}),
        },
        select: {
            sceneId: true,
            searchText: true,
            contentHash: true,
            embeddingJson: true,
            embeddingHash: true,
            embeddingGroupId: true,
            embeddingError: true,
        },
        orderBy: { sceneId: 'asc' },
    })
    if (input.sceneId && indexes.length === 0) {
        const scene = await prisma.scene.findFirst({
            where: { id: input.sceneId, chapter: { novelId: novel.id } },
            select: { id: true },
        })
        if (!scene) throw new Error('Scene not found.')
        return { updated: 0, skipped: 1, groupId: group.groupId, assignmentId: null, modelId: null }
    }

    const indexesToUpdate = input.sceneId
        ? indexes
        : indexes.filter((index) =>
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
                batch.map((index) => prepareModelText(index.searchText, MAX_EMBEDDING_CHARACTERS)),
                input.signal
            )
            lastAssignment = assignment
            await prisma.$transaction(
                batch.map((index, batchIndex) => {
                    const vector = vectors[batchIndex]
                    return prisma.sceneRetrievalIndex.update({
                        where: { sceneId: index.sceneId },
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
                })
            )
            updated += batch.length
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Embedding update failed.'
            await prisma.sceneRetrievalIndex.updateMany({
                where: { sceneId: { in: batch.map((index) => index.sceneId) } },
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

function scoreById(ranking: RankedItem[]) {
    return new Map(ranking.map((item) => [item.id, item.score]))
}

export async function searchNovelScenes(
    prisma: PrismaClient,
    input: { ownerId: string; novelId: string; query: string; topK?: number; signal?: AbortSignal }
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

    const topK = normalizeRetrievalTopK(input.topK, novel.retrievalTopK)
    const candidateLimit = getRetrievalCandidateLimit(topK)
    await syncNovelSceneRetrievalIndexes(prisma, novel.id)

    const indexes = await prisma.sceneRetrievalIndex.findMany({
        where: { novelId: novel.id, searchText: { not: '' } },
        include: {
            scene: {
                select: {
                    id: true,
                    order: true,
                    chapter: {
                        select: { id: true, title: true, order: true, actNumber: true },
                    },
                },
            },
        },
    })

    const bm25Ranking = rankBm25(
        query,
        indexes.map((index) => ({ id: index.sceneId, text: index.searchText })),
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
            const vectorDocuments = indexes.flatMap((index) => {
                if (index.embeddingGroupId !== group.groupId) return []
                const vector = parseVector(index.embeddingJson)
                return vector ? [{ id: index.sceneId, vector }] : []
            })
            if (vectorDocuments.length > 0) {
                const { vectors } = await createEmbeddingsWithGroup(
                    prisma,
                    group,
                    [prepareModelText(query, MAX_EMBEDDING_CHARACTERS)],
                    input.signal
                )
                const [queryVector] = vectors
                vectorRanking = rankVectors(queryVector, vectorDocuments, candidateLimit)
            }
        } catch (error) {
            warnings.push(`Embedding retrieval was skipped: ${error instanceof Error ? error.message : 'provider error'}`)
        }
    }

    const fusedRanking = vectorRanking.length > 0
        ? reciprocalRankFusion([bm25Ranking, vectorRanking], candidateLimit)
        : bm25Ranking.slice(0, candidateLimit)
    const indexesBySceneId = new Map(indexes.map((index) => [index.sceneId, index]))
    let finalRanking = fusedRanking
    const rerankerScores = new Map<string, number>()
    let rerankerUsed = false

    if (
        novel.retrievalRerankerEnabled
        && novel.retrievalRerankerGroupId
        && fusedRanking.length > 0
    ) {
        try {
            const group = await loadRetrievalGroup(prisma, {
                ownerId: input.ownerId,
                groupId: novel.retrievalRerankerGroupId,
                capability: 'reranker',
            })
            const candidates = fusedRanking
                .map((item) => indexesBySceneId.get(item.id))
                .filter((index): index is NonNullable<typeof index> => Boolean(index))
            const { results: reranked } = await rerankDocumentsWithGroup(prisma, group, {
                query,
                documents: candidates.map((index) => prepareModelText(index.searchText, MAX_RERANK_CHARACTERS)),
                topN: candidates.length,
            }, input.signal)
            const rerankedIds = reranked.map((item) => candidates[item.index]?.sceneId).filter(Boolean) as string[]
            reranked.forEach((item) => {
                const sceneId = candidates[item.index]?.sceneId
                if (sceneId) rerankerScores.set(sceneId, item.score)
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
            warnings.push(`Reranking was skipped: ${error instanceof Error ? error.message : 'provider error'}`)
        }
    }

    const bm25Scores = scoreById(bm25Ranking)
    const vectorScores = scoreById(vectorRanking)
    const fusionScores = scoreById(fusedRanking)
    const expectedGroupId = novel.retrievalEmbeddingEnabled ? novel.retrievalEmbeddingGroupId : null
    const results: HybridSceneSearchResult[] = finalRanking.slice(0, topK).flatMap((item) => {
        const index = indexesBySceneId.get(item.id)
        if (!index) return []
        return [{
            sceneId: index.sceneId,
            chapterId: index.scene.chapter.id,
            chapterTitle: index.scene.chapter.title,
            chapterOrder: index.scene.chapter.order,
            actNumber: index.scene.chapter.actNumber,
            sceneOrder: index.scene.order,
            excerpt: buildExcerpt(index.searchText, query),
            embeddingStatus: getEmbeddingStatus(index, expectedGroupId),
            scores: {
                bm25: bm25Scores.get(index.sceneId) ?? null,
                vector: vectorScores.get(index.sceneId) ?? null,
                fusion: fusionScores.get(index.sceneId) ?? null,
                reranker: rerankerScores.get(index.sceneId) ?? null,
            },
        }]
    })

    return {
        query,
        topK,
        candidateLimit,
        modes: {
            bm25: true,
            embedding: novel.retrievalEmbeddingEnabled,
            reranker: novel.retrievalRerankerEnabled,
            embeddingUsed: vectorRanking.length > 0,
            rerankerUsed,
        },
        warnings,
        results,
    }
}
