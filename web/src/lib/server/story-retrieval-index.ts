import type { PrismaClient } from '@/generated/prisma/client'
import { hashRetrievalText } from '@/lib/server/scene-retrieval-index'

export const STORY_RETRIEVAL_SOURCE_KINDS = ['ENTITY', 'FACT', 'EPISODE'] as const
export type StoryRetrievalSourceKind = (typeof STORY_RETRIEVAL_SOURCE_KINDS)[number]

type StoryRetrievalDocument = {
    sourceKind: StoryRetrievalSourceKind
    sourceId: string
    searchText: string
    contentHash: string
}

function normalizedDocument(input: Omit<StoryRetrievalDocument, 'contentHash'>): StoryRetrievalDocument | null {
    const searchText = input.searchText
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
    if (!searchText) return null
    return { ...input, searchText, contentHash: hashRetrievalText(searchText) }
}

export async function syncNovelStoryRetrievalIndexes(prisma: PrismaClient, novelId: string) {
    const [entities, facts, episodes, existing] = await Promise.all([
        prisma.storyEntity.findMany({
            where: { novelId },
            include: { aliases: { orderBy: { createdAt: 'asc' } } },
        }),
        prisma.storyFact.findMany({
            where: { novelId },
            include: {
                subjectEntity: { select: { name: true } },
                objectEntity: { select: { name: true } },
            },
        }),
        prisma.storyEpisode.findMany({ where: { novelId } }),
        prisma.storyRetrievalIndex.findMany({
            where: { novelId },
            select: { id: true, sourceKind: true, sourceId: true, contentHash: true },
        }),
    ])

    const documents = [
        ...entities.map((entity) => normalizedDocument({
            sourceKind: 'ENTITY' as const,
            sourceId: entity.id,
            searchText: [
                entity.name,
                ...entity.aliases.map((alias) => alias.alias),
                entity.kind,
                entity.summary,
            ].filter(Boolean).join(' '),
        })),
        ...facts.map((fact) => normalizedDocument({
            sourceKind: 'FACT' as const,
            sourceId: fact.id,
            searchText: [
                fact.factText,
                fact.subjectEntity.name,
                fact.predicateKey,
                fact.objectEntity?.name ?? fact.objectValue,
            ].filter(Boolean).join(' '),
        })),
        ...episodes.map((episode) => normalizedDocument({
            sourceKind: 'EPISODE' as const,
            sourceId: episode.id,
            searchText: episode.content,
        })),
    ].filter((document): document is StoryRetrievalDocument => Boolean(document))

    const existingByKey = new Map(
        existing.map((index) => [`${index.sourceKind}:${index.sourceId}`, index])
    )
    const desiredKeys = new Set(documents.map((document) => `${document.sourceKind}:${document.sourceId}`))
    let updated = 0

    for (const document of documents) {
        const key = `${document.sourceKind}:${document.sourceId}`
        if (existingByKey.get(key)?.contentHash === document.contentHash) continue
        await prisma.storyRetrievalIndex.upsert({
            where: {
                novelId_sourceKind_sourceId: {
                    novelId,
                    sourceKind: document.sourceKind,
                    sourceId: document.sourceId,
                },
            },
            create: { novelId, ...document },
            update: { searchText: document.searchText, contentHash: document.contentHash },
        })
        updated += 1
    }

    const orphanIds = existing
        .filter((index) => !desiredKeys.has(`${index.sourceKind}:${index.sourceId}`))
        .map((index) => index.id)
    if (orphanIds.length > 0) {
        await prisma.storyRetrievalIndex.deleteMany({ where: { id: { in: orphanIds } } })
    }

    return { documentCount: documents.length, updated, removed: orphanIds.length }
}
