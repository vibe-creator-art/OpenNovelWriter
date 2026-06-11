import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { serializeScene } from '@/lib/scenes'
import { syncNovelWorkspaceChapter, syncNovelWorkspaceOutline } from '@/lib/server/novel-workspace'

// Helper function to strip HTML tags and get plain text
function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

// Helper function to calculate word count based on language
// For CJK languages (Chinese, Japanese, Korean), count characters
// For other languages, count words (separated by spaces)
function calculateWordCount(content: string, language: string | null): number {
    const text = stripHtml(content).trim()
    if (!text) return 0

    // Check if language is CJK (Chinese, Japanese, Korean)
    const isCJK = language?.startsWith('zh') || language?.startsWith('ja') || language?.startsWith('ko')

    if (isCJK) {
        // For CJK: count all non-whitespace characters
        // This includes Chinese characters, punctuation, and any embedded Latin characters
        return text.replace(/\s/g, '').length
    } else {
        // For other languages: count words separated by whitespace
        const words = text.split(/\s+/).filter(word => word.length > 0)
        return words.length
    }
}

interface RouteParams {
    params: Promise<{ id: string }>
}

// GET /api/novels/[id]/chapters - Get all chapters for a novel
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params

        // Verify novel ownership
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const chapters = await prisma.chapter.findMany({
            where: { novelId },
            orderBy: [{ actNumber: 'asc' }, { order: 'asc' }],
        })

        return NextResponse.json(chapters)
    } catch (error) {
        console.error('Get chapters error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/novels/[id]/chapters - Create a new chapter
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params
        const body = await request.json()
        const { title, content, actNumber, order } = body

        // Verify novel ownership
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        // Calculate order if not provided
        let chapterOrder = order
        if (chapterOrder === undefined) {
            const lastChapter = await prisma.chapter.findFirst({
                where: { novelId, actNumber: actNumber || 1 },
                orderBy: { order: 'desc' },
            })
            chapterOrder = lastChapter ? lastChapter.order + 1 : 1
        }

        // Calculate word count using language-aware counting
        const wordCount = content ? calculateWordCount(content, novel.language) : 0

        const chapter = await prisma.chapter.create({
            data: {
                title: title || 'Untitled Chapter',
                actNumber: actNumber || 1,
                order: chapterOrder,
                wordCount,
                novelId,
            },
        })

        // Create default scene for the new chapter
        const defaultScene = await prisma.scene.create({
            data: {
                chapterId: chapter.id,
                order: 0,
                content: content || '',
                wordCount,
            },
        })
        await Promise.all([
            syncNovelWorkspaceOutline(user.userId, novelId),
            syncNovelWorkspaceChapter(user.userId, novelId, chapter.id),
        ])

        // Return chapter with scenes included
        return NextResponse.json({ ...chapter, scenes: [serializeScene(defaultScene)] }, { status: 201 })
    } catch (error) {
        console.error('Create chapter error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
