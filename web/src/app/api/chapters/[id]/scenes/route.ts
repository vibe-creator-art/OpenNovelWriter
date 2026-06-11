import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { serializeScene } from '@/lib/scenes'
import { syncNovelWorkspaceChapter, syncNovelWorkspaceOutline } from '@/lib/server/novel-workspace'

interface RouteParams {
    params: Promise<{ id: string }>
}

// GET /api/chapters/[id]/scenes - List all scenes for a chapter
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: chapterId } = await params

        // Verify chapter exists and user owns it
        const chapter = await prisma.chapter.findUnique({
            where: { id: chapterId },
            include: { novel: { select: { ownerId: true } } }
        })

        if (!chapter) {
            return NextResponse.json({ detail: 'Chapter not found' }, { status: 404 })
        }

        if (chapter.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
        }

        const scenes = await prisma.scene.findMany({
            where: { chapterId },
            orderBy: { order: 'asc' }
        })

        return NextResponse.json(scenes.map(serializeScene))
    } catch (error) {
        console.error('List scenes error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/chapters/[id]/scenes - Create a new scene in a chapter
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: chapterId } = await params

        // Verify chapter exists and user owns it
        const chapter = await prisma.chapter.findUnique({
            where: { id: chapterId },
            include: { novel: { select: { ownerId: true } } }
        })

        if (!chapter) {
            return NextResponse.json({ detail: 'Chapter not found' }, { status: 404 })
        }

        if (chapter.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
        }

        // Get max order for this chapter's scenes
        const maxOrderScene = await prisma.scene.findFirst({
            where: { chapterId },
            orderBy: { order: 'desc' }
        })
        const newOrder = (maxOrderScene?.order ?? -1) + 1

        const scene = await prisma.scene.create({
            data: {
                chapterId,
                order: newOrder,
                content: '',
                wordCount: 0,
            }
        })
        await Promise.all([
            syncNovelWorkspaceOutline(user.userId, chapter.novelId),
            syncNovelWorkspaceChapter(user.userId, chapter.novelId, chapterId),
        ])

        return NextResponse.json(serializeScene(scene), { status: 201 })
    } catch (error) {
        console.error('Create scene error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
