import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { recordRevisionHistory, safeParseRevisionHistoryJson } from '@/lib/revision-history'
import { removeNovelWorkspaceSnippet, syncNovelWorkspaceSnippet } from '@/lib/server/novel-workspace'

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

function toSnippetResponse(snippet: {
    id: string
    title: string
    content: string
    pinned: boolean
    wordCount: number
    historyJson: string
    novelId: string
    createdAt: Date
    updatedAt: Date
}) {
    return {
        id: snippet.id,
        title: snippet.title,
        content: snippet.content,
        pinned: snippet.pinned,
        wordCount: snippet.wordCount,
        history: safeParseRevisionHistoryJson(snippet.historyJson, { idPrefix: 'snippet' }),
        novelId: snippet.novelId,
        createdAt: snippet.createdAt,
        updatedAt: snippet.updatedAt,
    }
}

// GET /api/snippets/[id] - Get a single snippet
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        const snippet = await prisma.snippet.findUnique({
            where: { id },
            include: { novel: { select: { ownerId: true } } },
        })

        if (!snippet || snippet.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Snippet not found' }, { status: 404 })
        }

        return NextResponse.json(toSnippetResponse(snippet))
    } catch (error) {
        console.error('Get snippet error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// PUT /api/snippets/[id] - Update a snippet
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json().catch(() => ({}))

        const existing = await prisma.snippet.findUnique({
            where: { id },
            include: { novel: { select: { ownerId: true } } },
        })

        if (!existing || existing.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Snippet not found' }, { status: 404 })
        }

        const data: { title?: string; content?: string; pinned?: boolean; wordCount?: number; historyJson?: string } = {}
        if (body && typeof body === 'object') {
            if (typeof body.title === 'string') data.title = body.title
            if (typeof body.content === 'string') data.content = body.content
            if (typeof body.pinned === 'boolean') data.pinned = body.pinned
        }

        const nextContent = data.content
        if (nextContent !== undefined && nextContent !== existing.content) {
            data.wordCount = calculateWordCountFromHtml(nextContent)

            const now = Date.now()
            const history = safeParseRevisionHistoryJson(existing.historyJson, { idPrefix: 'snippet' })
            const { history: nextHistory, recorded } = recordRevisionHistory(history, nextContent, {
                now,
                idPrefix: 'snippet',
                normalize: (value) => value.trim(),
            })
            if (recorded) data.historyJson = JSON.stringify(nextHistory)
        }

        const snippet = await prisma.snippet.update({
            where: { id },
            data,
        })
        await syncNovelWorkspaceSnippet(user.userId, snippet.novelId, snippet.id)

        return NextResponse.json(toSnippetResponse(snippet))
    } catch (error) {
        console.error('Update snippet error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/snippets/[id] - Delete a snippet
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        const existing = await prisma.snippet.findUnique({
            where: { id },
            include: { novel: { select: { ownerId: true } } },
        })

        if (!existing || existing.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Snippet not found' }, { status: 404 })
        }

        await prisma.snippet.delete({ where: { id } })
        await removeNovelWorkspaceSnippet(user.userId, existing.novelId, existing.id)

        return NextResponse.json({ message: 'Snippet deleted successfully' })
    } catch (error) {
        console.error('Delete snippet error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
