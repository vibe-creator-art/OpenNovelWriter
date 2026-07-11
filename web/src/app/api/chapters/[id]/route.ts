import { NextRequest, NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import {
    removeNovelWorkspaceChapter,
    syncNovelWorkspaceChapter,
    syncNovelWorkspaceOutline,
    syncNovelWorkspaceDetailedOutlines,
} from '@/lib/server/novel-workspace'
import { cascadeDeleteContinuationDraftsForScenes } from '@/lib/server/continuation-draft'
import { recordNovelWritingDelta } from '@/lib/server/manuscript-word-count'

interface RouteParams {
    params: Promise<{ id: string }>
}

const prisma = getPrismaClient({ ensureModel: 'novelWritingDay' })

// GET /api/chapters/[id] - Get a single chapter
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        const chapter = await prisma.chapter.findUnique({
            where: { id },
            include: {
                novel: {
                    select: { ownerId: true },
                },
            },
        })

        if (!chapter || chapter.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Chapter not found' }, { status: 404 })
        }

        return NextResponse.json({
            id: chapter.id,
            title: chapter.title,
            actNumber: chapter.actNumber,
            order: chapter.order,
            wordCount: chapter.wordCount,
            novelId: chapter.novelId,
            createdAt: chapter.createdAt,
            updatedAt: chapter.updatedAt,
        })
    } catch (error) {
        console.error('Get chapter error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// PUT /api/chapters/[id] - Update a chapter
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json()
        const { title, actNumber, order } = body

        // Check ownership
        const existing = await prisma.chapter.findUnique({
            where: { id },
            include: {
                novel: {
                    select: { ownerId: true },
                },
            },
        })

        if (!existing || existing.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Chapter not found' }, { status: 404 })
        }

        const chapter = await prisma.chapter.update({
            where: { id },
            data: {
                ...(title !== undefined && { title }),
                ...(actNumber !== undefined && { actNumber }),
                ...(order !== undefined && { order }),
            },
        })
        const syncTasks = [syncNovelWorkspaceOutline(user.userId, chapter.novelId)]
        if (title !== undefined) {
            syncTasks.push(syncNovelWorkspaceChapter(user.userId, chapter.novelId, chapter.id))
        }
        await Promise.all(syncTasks)

        return NextResponse.json(chapter)
    } catch (error) {
        console.error('Update chapter error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/chapters/[id] - Delete a chapter
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        // Check ownership
        const existing = await prisma.chapter.findUnique({
            where: { id },
            include: {
                novel: {
                    select: { ownerId: true },
                },
            },
        })

        if (!existing || existing.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Chapter not found' }, { status: 404 })
        }

        // Tear down inline continuation panels (drafts + paired Codex sessions) before the
        // chapter's scenes cascade-delete, so no orphaned sessions are left behind.
        const chapterScenes = await prisma.scene.findMany({ where: { chapterId: id }, select: { id: true, wordCount: true } })
        await cascadeDeleteContinuationDraftsForScenes(user.userId, chapterScenes.map((scene) => scene.id))

        const deletedWordCount = chapterScenes.reduce((sum, scene) => sum + scene.wordCount, 0)
        await prisma.$transaction(async (tx) => {
            await tx.chapter.delete({ where: { id } })
            await recordNovelWritingDelta(tx, existing.novelId, -deletedWordCount)
        })
        await Promise.all([
            syncNovelWorkspaceOutline(user.userId, existing.novelId),
            removeNovelWorkspaceChapter(user.userId, existing.novelId, existing.id),
            syncNovelWorkspaceDetailedOutlines(user.userId, existing.novelId),
        ])

        return NextResponse.json({ message: 'Chapter deleted successfully' })
    } catch (error) {
        console.error('Delete chapter error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
