import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { normalizeLabelIds } from '@/lib/labels'
import { serializeScene } from '@/lib/scenes'
import { normalizeTermIds } from '@/lib/term-ids'
import { syncNovelWorkspaceChapter, syncNovelWorkspaceOutline } from '@/lib/server/novel-workspace'
import { cascadeDeleteContinuationDraftsForScenes } from '@/lib/server/continuation-draft'

// Helper function to count words
function countWords(text: string): number {
    if (!text || text.trim() === '') return 0

    // Strip HTML tags - TipTap returns HTML content
    const plainText = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    if (!plainText.trim()) return 0

    // Handle Chinese/Japanese characters (count each character as a word)
    // and English words (space-separated)
    const chineseChars = plainText.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length || 0
    const englishWords = plainText
        .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 0).length
    return chineseChars + englishWords
}

interface RouteParams {
    params: Promise<{ id: string }>
}

// GET /api/scenes/[id] - Get a scene by ID
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        const scene = await prisma.scene.findUnique({
            where: { id },
            include: {
                chapter: {
                    select: { novelId: true, novel: { select: { ownerId: true } } }
                }
            }
        })

        if (!scene) {
            return NextResponse.json({ detail: 'Scene not found' }, { status: 404 })
        }

        if (scene.chapter.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
        }

        return NextResponse.json(serializeScene(scene))
    } catch (error) {
        console.error('Get scene error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// PUT /api/scenes/[id] - Update a scene
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json()
        const { content, summary, labelIds, termIds } = body

        // First verify ownership
        const scene = await prisma.scene.findUnique({
            where: { id },
            include: {
                chapter: {
                    select: { id: true, novelId: true, novel: { select: { ownerId: true } } }
                }
            }
        })

        if (!scene) {
            return NextResponse.json({ detail: 'Scene not found' }, { status: 404 })
        }

        if (scene.chapter.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
        }

        // Build update data
        const updateData: { content?: string; summary?: string; wordCount?: number; labelIdsJson?: string; termIdsJson?: string } = {}
        if (content !== undefined) {
            updateData.content = content
            updateData.wordCount = countWords(content)
        }
        if (summary !== undefined) {
            updateData.summary = summary
        }
        if (labelIds !== undefined) {
            const normalized = normalizeLabelIds(labelIds)
            if (!normalized) {
                return NextResponse.json({ detail: 'Invalid labelIds' }, { status: 400 })
            }
            if (normalized.length === 0) {
                updateData.labelIdsJson = JSON.stringify([])
            } else {
                const allowed = await prisma.label.findMany({
                    where: { novelId: scene.chapter.novelId, id: { in: normalized } },
                    select: { id: true },
                })
                const allowedSet = new Set(allowed.map(l => l.id))
                const sanitized = normalized.filter(id => allowedSet.has(id))
                updateData.labelIdsJson = JSON.stringify(sanitized)
            }
        }
        if (termIds !== undefined) {
            const normalized = normalizeTermIds(termIds)
            if (!normalized) {
                return NextResponse.json({ detail: 'Invalid termIds' }, { status: 400 })
            }
            updateData.termIdsJson = JSON.stringify(normalized)
        }

        const updated = await prisma.scene.update({
            where: { id },
            data: updateData,
        })

        // Also update chapter's total word count (sum of all scenes)
        const allScenes = await prisma.scene.findMany({
            where: { chapterId: scene.chapter.id },
            select: { wordCount: true }
        })
        const totalWordCount = allScenes.reduce((sum, s) => sum + s.wordCount, 0)
        await prisma.chapter.update({
            where: { id: scene.chapter.id },
            data: { wordCount: totalWordCount }
        })
        const syncTasks = [
            syncNovelWorkspaceChapter(user.userId, scene.chapter.novelId, scene.chapter.id),
        ]
        if (summary !== undefined) {
            syncTasks.push(syncNovelWorkspaceOutline(user.userId, scene.chapter.novelId))
        }
        await Promise.all(syncTasks)

        return NextResponse.json(serializeScene(updated))
    } catch (error) {
        console.error('Update scene error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/scenes/[id] - Delete a scene
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        // First verify ownership
        const scene = await prisma.scene.findUnique({
            where: { id },
            include: {
                chapter: {
                    select: { id: true, novelId: true, novel: { select: { ownerId: true } } }
                }
            }
        })

        if (!scene) {
            return NextResponse.json({ detail: 'Scene not found' }, { status: 404 })
        }

        if (scene.chapter.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
        }

        // Count remaining scenes - don't allow deleting the last scene
        const sceneCount = await prisma.scene.count({
            where: { chapterId: scene.chapterId }
        })

        if (sceneCount <= 1) {
            return NextResponse.json({ detail: 'Cannot delete the last scene' }, { status: 400 })
        }

        // Tear down inline continuation panels in this scene (drafts + paired Codex sessions).
        await cascadeDeleteContinuationDraftsForScenes(user.userId, [id])

        await prisma.scene.delete({ where: { id } })

        // Re-order remaining scenes
        const remainingScenes = await prisma.scene.findMany({
            where: { chapterId: scene.chapterId },
            orderBy: { order: 'asc' }
        })

        for (let i = 0; i < remainingScenes.length; i++) {
            await prisma.scene.update({
                where: { id: remainingScenes[i].id },
                data: { order: i }
            })
        }

        // Update chapter's total word count
        const allScenes = await prisma.scene.findMany({
            where: { chapterId: scene.chapter.id },
            select: { wordCount: true }
        })
        const totalWordCount = allScenes.reduce((sum, s) => sum + s.wordCount, 0)
        await prisma.chapter.update({
            where: { id: scene.chapter.id },
            data: { wordCount: totalWordCount }
        })
        await Promise.all([
            syncNovelWorkspaceOutline(user.userId, scene.chapter.novelId),
            syncNovelWorkspaceChapter(user.userId, scene.chapter.novelId, scene.chapter.id),
        ])

        return NextResponse.json({ message: 'Scene deleted' })
    } catch (error) {
        console.error('Delete scene error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
