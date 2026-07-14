import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { serializeScene } from '@/lib/scenes'
import { deleteCodexSessionWorkspace } from '@/lib/server/codex-session-workspace'
import { deleteNovelWorkspace, ensureNovelWorkspace } from '@/lib/server/novel-workspace'
import { parseCodexSessionRetentionLimit } from '@/lib/codex-session-retention'

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
            codexSessionAutoCleanup,
            codexSessionRetentionLimit,
        } = body
        const shouldUpdateCoverImage = Object.prototype.hasOwnProperty.call(body, 'coverImage')
        const shouldUpdateCoverCrop = Object.prototype.hasOwnProperty.call(body, 'coverCrop')
        const shouldUpdateCodexSessionAutoCleanup = Object.prototype.hasOwnProperty.call(body, 'codexSessionAutoCleanup')
        const shouldUpdateCodexSessionRetentionLimit = Object.prototype.hasOwnProperty.call(body, 'codexSessionRetentionLimit')

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
        const parsedCodexSessionRetentionLimit = shouldUpdateCodexSessionRetentionLimit
            ? parseCodexSessionRetentionLimit(codexSessionRetentionLimit)
            : existing.codexSessionRetentionLimit
        if (parsedCodexSessionRetentionLimit === null) {
            return NextResponse.json({ detail: 'Codex session retention limit must be an integer of at least 10' }, { status: 400 })
        }

        const nextCoverImage = shouldUpdateCoverImage ? (coverImage || null) : existing.coverImage
        // A crop only makes sense alongside a cover: clear it whenever the cover is gone.
        const nextCoverCrop = !nextCoverImage
            ? null
            : shouldUpdateCoverCrop
              ? (coverCrop || null)
              : existing.coverCrop

        const novel = await prisma.novel.update({
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
                codexSessionAutoCleanup: shouldUpdateCodexSessionAutoCleanup
                    ? codexSessionAutoCleanup
                    : existing.codexSessionAutoCleanup,
                codexSessionRetentionLimit: parsedCodexSessionRetentionLimit,
            },
        })

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
