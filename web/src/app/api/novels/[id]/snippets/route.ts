import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { syncNovelWorkspaceSnippet } from '@/lib/server/novel-workspace'

interface RouteParams {
    params: Promise<{ id: string }>
}

function stripHtml(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
}

function countWords(text: string): number {
    if (!text || text.trim() === '') return 0

    const plainText = text.replace(/\s+/g, ' ').trim()
    if (!plainText) return 0

    const chineseChars = plainText.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length || 0
    const englishWords = plainText
        .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length
    return chineseChars + englishWords
}

function calculateWordCountFromHtml(content: string): number {
    const text = stripHtml(content).trim()
    if (!text) return 0
    return countWords(text)
}

// GET /api/novels/[id]/snippets - List snippets for a novel
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params

        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const snippets = await prisma.snippet.findMany({
            where: { novelId },
            orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
            select: {
                id: true,
                title: true,
                content: true,
                pinned: true,
                wordCount: true,
                novelId: true,
                createdAt: true,
                updatedAt: true,
            },
        })

        return NextResponse.json(snippets)
    } catch (error) {
        console.error('List snippets error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/novels/[id]/snippets - Create snippet in a novel
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params

        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => ({}))
        const title = typeof body?.title === 'string' ? body.title : ''
        const content = typeof body?.content === 'string' ? body.content : ''
        const pinned = typeof body?.pinned === 'boolean' ? body.pinned : false

        const snippet = await prisma.snippet.create({
            data: {
                novelId,
                title,
                content,
                pinned,
                wordCount: calculateWordCountFromHtml(content),
            },
        })
        await syncNovelWorkspaceSnippet(user.userId, novelId, snippet.id)

        const snippetData = { ...snippet } as Record<string, unknown>
        delete snippetData.historyJson
        return NextResponse.json(snippetData, { status: 201 })
    } catch (error) {
        console.error('Create snippet error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
