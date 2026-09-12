import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { serializeScene } from '@/lib/scenes'
import { deleteCodexSessionWorkspace } from '@/lib/server/codex-session-workspace'
import { deleteNovelWorkspace, ensureNovelWorkspace } from '@/lib/server/novel-workspace'
import { parseCodexSessionRetentionLimit } from '@/lib/codex-session-retention'
import { petExists } from '@/lib/server/pet-storage'
import { loadRetrievalGroup } from '@/lib/server/retrieval-models'
import { skipCodexUserInputForNovel } from '@/lib/server/codex-user-input-bridge'

interface RouteParams {
    params: Promise<{ id: string }>
}

// GET /api/novels/[id] - Get a single novel
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        const novel = await prisma.novel.findFirst({
            where: {
                id,
                ownerId: user.userId,
            },
            include: {
                chapters: {
                    orderBy: [{ actNumber: 'asc' }, { order: 'asc' }],
                    include: {
                        scenes: {
                            orderBy: { order: 'asc' },
                        },
                    },
                },
            },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }
        return NextResponse.json({
            ...novel,
            chapters: novel.chapters.map((chapter) => ({
                ...chapter,
                scenes: chapter.scenes.map(serializeScene),
            })),
        })
    } catch (error) {
        console.error('Get novel error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// PUT /api/novels/[id] - Update a novel
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json()
        const {
            title,
            description,
            category,
            coverImage,
            coverCrop,
            authorName,
            series,
            seriesIndex,
            language,
            outlineActSummaryCollapsesChapters,
            termContextIncludesRelations,
            termContextIncludesExperiences,
            retrievalEmbeddingEnabled,
            retrievalEmbeddingGroupId,
            retrievalRerankerEnabled,
            retrievalRerankerGroupId,
            retrievalTopK,
            codexSessionAutoCleanup,
            codexSessionRetentionLimit,
            codexUserInputEnabled,
            codexShowReasoning,
            codexCustomFastModeEnabled,
            codexPetEnabled,
            codexPetId,
        } = body
        const shouldUpdateCoverImage = Object.prototype.hasOwnProperty.call(body, 'coverImage')
        const shouldUpdateCoverCrop = Object.prototype.hasOwnProperty.call(body, 'coverCrop')
        const shouldUpdateTermContextIncludesRelations = Object.prototype.hasOwnProperty.call(
            body,
            'termContextIncludesRelations'
        )
        const shouldUpdateTermContextIncludesExperiences = Object.prototype.hasOwnProperty.call(
            body,
            'termContextIncludesExperiences'
        )
        const shouldUpdateRetrievalEmbeddingEnabled = Object.prototype.hasOwnProperty.call(body, 'retrievalEmbeddingEnabled')
        const shouldUpdateRetrievalEmbeddingGroupId = Object.prototype.hasOwnProperty.call(body, 'retrievalEmbeddingGroupId')
        const shouldUpdateRetrievalRerankerEnabled = Object.prototype.hasOwnProperty.call(body, 'retrievalRerankerEnabled')
        const shouldUpdateRetrievalRerankerGroupId = Object.prototype.hasOwnProperty.call(body, 'retrievalRerankerGroupId')
        const shouldUpdateRetrievalTopK = Object.prototype.hasOwnProperty.call(body, 'retrievalTopK')
        const shouldUpdateCodexSessionAutoCleanup = Object.prototype.hasOwnProperty.call(body, 'codexSessionAutoCleanup')
        const shouldUpdateCodexSessionRetentionLimit = Object.prototype.hasOwnProperty.call(body, 'codexSessionRetentionLimit')
        const shouldUpdateCodexPetEnabled = Object.prototype.hasOwnProperty.call(body, 'codexPetEnabled')
        const shouldUpdateCodexUserInputEnabled = Object.prototype.hasOwnProperty.call(body, 'codexUserInputEnabled')
        const shouldUpdateCodexShowReasoning = Object.prototype.hasOwnProperty.call(body, 'codexShowReasoning')
        const shouldUpdateCodexCustomFastModeEnabled = Object.prototype.hasOwnProperty.call(body, 'codexCustomFastModeEnabled')
        const shouldUpdateCodexPetId = Object.prototype.hasOwnProperty.call(body, 'codexPetId')

        // Check ownership
        const existing = await prisma.novel.findFirst({
            where: { id, ownerId: user.userId },
        })

        if (!existing) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        if (shouldUpdateCodexSessionAutoCleanup && typeof codexSessionAutoCleanup !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid Codex session cleanup setting' }, { status: 400 })
        }
        if (shouldUpdateTermContextIncludesRelations && typeof termContextIncludesRelations !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid term relation context setting' }, { status: 400 })
        }
        if (shouldUpdateTermContextIncludesExperiences && typeof termContextIncludesExperiences !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid term experience context setting' }, { status: 400 })
        }
        if (shouldUpdateRetrievalEmbeddingEnabled && typeof retrievalEmbeddingEnabled !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid embedding retrieval setting' }, { status: 400 })
        }
        if (shouldUpdateRetrievalRerankerEnabled && typeof retrievalRerankerEnabled !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid reranker retrieval setting' }, { status: 400 })
        }
        if (
            shouldUpdateRetrievalTopK
            && (!Number.isInteger(retrievalTopK) || retrievalTopK < 1 || retrievalTopK > 50)
        ) {
            return NextResponse.json({ detail: 'Retrieval Top K must be an integer from 1 to 50' }, { status: 400 })
        }
        if (shouldUpdateCodexPetEnabled && typeof codexPetEnabled !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid Codex pet enabled setting' }, { status: 400 })
        }
        if (shouldUpdateCodexUserInputEnabled && typeof codexUserInputEnabled !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid Codex clarification setting' }, { status: 400 })
        }
        if (shouldUpdateCodexShowReasoning && typeof codexShowReasoning !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid Codex reasoning display setting' }, { status: 400 })
        }
        if (shouldUpdateCodexCustomFastModeEnabled && typeof codexCustomFastModeEnabled !== 'boolean') {
            return NextResponse.json({ detail: 'Invalid Codex custom Fast mode setting' }, { status: 400 })
        }
        if (
            shouldUpdateCodexPetId
            && (typeof codexPetId !== 'string' || !(await petExists(user.userId, codexPetId)))
        ) {
            return NextResponse.json({ detail: 'Selected Codex pet was not found' }, { status: 400 })
        }
        const parsedCodexSessionRetentionLimit = shouldUpdateCodexSessionRetentionLimit
            ? parseCodexSessionRetentionLimit(codexSessionRetentionLimit)
            : existing.codexSessionRetentionLimit
        if (parsedCodexSessionRetentionLimit === null) {
            return NextResponse.json({ detail: 'Codex session retention limit must be an integer of at least 10' }, { status: 400 })
        }

        const nextEmbeddingEnabled = shouldUpdateRetrievalEmbeddingEnabled
            ? retrievalEmbeddingEnabled
            : existing.retrievalEmbeddingEnabled
        const nextEmbeddingGroupId = shouldUpdateRetrievalEmbeddingGroupId
            ? (typeof retrievalEmbeddingGroupId === 'string' && retrievalEmbeddingGroupId.trim()
                ? retrievalEmbeddingGroupId.trim()
                : null)
            : existing.retrievalEmbeddingGroupId
        const nextRerankerEnabled = shouldUpdateRetrievalRerankerEnabled
            ? retrievalRerankerEnabled
            : existing.retrievalRerankerEnabled
        const nextRerankerGroupId = shouldUpdateRetrievalRerankerGroupId
            ? (typeof retrievalRerankerGroupId === 'string' && retrievalRerankerGroupId.trim()
                ? retrievalRerankerGroupId.trim()
                : null)
            : existing.retrievalRerankerGroupId

        if (nextEmbeddingEnabled && !nextEmbeddingGroupId) {
            return NextResponse.json({ detail: 'Select an embedding model group before enabling embedding retrieval' }, { status: 400 })
        }
        if (nextRerankerEnabled && !nextRerankerGroupId) {
            return NextResponse.json({ detail: 'Select a reranker model group before enabling reranking' }, { status: 400 })
        }
        const embeddingConfigChanged =
            nextEmbeddingEnabled !== existing.retrievalEmbeddingEnabled
            || nextEmbeddingGroupId !== existing.retrievalEmbeddingGroupId
        const rerankerConfigChanged =
            nextRerankerEnabled !== existing.retrievalRerankerEnabled
            || nextRerankerGroupId !== existing.retrievalRerankerGroupId
        try {
            if (embeddingConfigChanged && nextEmbeddingEnabled && nextEmbeddingGroupId) {
                await loadRetrievalGroup(prisma, {
                    ownerId: user.userId,
                    groupId: nextEmbeddingGroupId,
                    capability: 'embedding',
                })
            }
            if (rerankerConfigChanged && nextRerankerEnabled && nextRerankerGroupId) {
                await loadRetrievalGroup(prisma, {
                    ownerId: user.userId,
                    groupId: nextRerankerGroupId,
                    capability: 'reranker',
                })
            }
        } catch (error) {
            return NextResponse.json({
                detail: error instanceof Error ? error.message : 'Selected retrieval model is unavailable.',
            }, { status: 400 })
        }

        const nextCoverImage = shouldUpdateCoverImage ? (coverImage || null) : existing.coverImage
        // A crop only makes sense alongside a cover: clear it whenever the cover is gone.
        const nextCoverCrop = !nextCoverImage
            ? null
            : shouldUpdateCoverCrop
              ? (coverCrop || null)
              : existing.coverCrop

        const [novel] = await prisma.$transaction([
            prisma.novel.update({
                where: { id },
                data: {
                title: title ?? existing.title,
                description: description ?? existing.description,
                category: category ?? existing.category,
                coverImage: nextCoverImage,
                coverCrop: nextCoverCrop,
                authorName: authorName ?? existing.authorName,
                series: series ?? existing.series,
                seriesIndex: seriesIndex ?? existing.seriesIndex,
                language: language ?? existing.language,
                outlineActSummaryCollapsesChapters:
                    outlineActSummaryCollapsesChapters ?? existing.outlineActSummaryCollapsesChapters,
                termContextIncludesRelations: shouldUpdateTermContextIncludesRelations
                    ? termContextIncludesRelations
                    : existing.termContextIncludesRelations,
                termContextIncludesExperiences: shouldUpdateTermContextIncludesExperiences
                    ? termContextIncludesExperiences
                    : existing.termContextIncludesExperiences,
                retrievalEmbeddingEnabled: nextEmbeddingEnabled,
                retrievalEmbeddingGroupId: nextEmbeddingGroupId,
                retrievalRerankerEnabled: nextRerankerEnabled,
                retrievalRerankerGroupId: nextRerankerGroupId,
                retrievalTopK: shouldUpdateRetrievalTopK ? retrievalTopK : existing.retrievalTopK,
                codexSessionAutoCleanup: shouldUpdateCodexSessionAutoCleanup
                    ? codexSessionAutoCleanup
                    : existing.codexSessionAutoCleanup,
                codexSessionRetentionLimit: parsedCodexSessionRetentionLimit,
                codexUserInputEnabled: shouldUpdateCodexUserInputEnabled ? codexUserInputEnabled : existing.codexUserInputEnabled,
                codexShowReasoning: shouldUpdateCodexShowReasoning ? codexShowReasoning : existing.codexShowReasoning,
                codexCustomFastModeEnabled: shouldUpdateCodexCustomFastModeEnabled ? codexCustomFastModeEnabled : existing.codexCustomFastModeEnabled,
                codexPetEnabled: shouldUpdateCodexPetEnabled ? codexPetEnabled : existing.codexPetEnabled,
                codexPetId: shouldUpdateCodexPetId ? codexPetId : existing.codexPetId,
                },
            }),
        ])

        if (!novel.codexUserInputEnabled) skipCodexUserInputForNovel(novel.id)

        // Orphaned cover files (replaced or cleared here) are reclaimed by the
        // startup image GC — see lib/server/image-gc.ts.
        await ensureNovelWorkspace(user.userId, novel.id)

        return NextResponse.json(novel)
    } catch (error) {
        console.error('Update novel error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/novels/[id] - Delete a novel
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        // Check ownership
        const existing = await prisma.novel.findFirst({
            where: { id, ownerId: user.userId },
        })

        if (!existing) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const codexSessions = await prisma.codexSession.findMany({
            where: {
                novelId: id,
                ownerId: user.userId,
            },
            select: {
                id: true,
            },
        })

        await prisma.novel.delete({
            where: { id },
        })

        // The deleted novel's cover file is reclaimed by the startup image GC.
        const cleanupResults = await Promise.allSettled([
            deleteNovelWorkspace(user.userId, id),
            ...codexSessions.map((session) => deleteCodexSessionWorkspace(user.userId, session.id)),
        ])
        cleanupResults.forEach((result, index) => {
            if (result.status === 'rejected') {
                const target = index === 0 ? `novel workspace ${id}` : `codex session workspace ${codexSessions[index - 1]?.id ?? 'unknown'}`
                console.error(`Failed to delete ${target}:`, result.reason)
            }
        })

        return NextResponse.json({ message: 'Novel deleted successfully' })
    } catch (error) {
        console.error('Delete novel error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
