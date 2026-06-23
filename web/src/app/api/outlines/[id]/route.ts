import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { recordRevisionHistory, safeParseRevisionHistoryJson } from '@/lib/revision-history'
import { syncNovelWorkspaceDetailedOutlines } from '@/lib/server/novel-workspace'

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

function toOutlineResponse(outline: {
    id: string
    type: string
    actNumber: number | null
    chapterId: string | null
    content: string
    wordCount: number
    historyJson: string
    novelId: string
    createdAt: Date
    updatedAt: Date
}) {
    return {
        id: outline.id,
        type: outline.type,
        actNumber: outline.actNumber,
        chapterId: outline.chapterId,
        content: outline.content,
        wordCount: outline.wordCount,
        history: safeParseRevisionHistoryJson(outline.historyJson, { idPrefix: 'outline' }),
        novelId: outline.novelId,
        createdAt: outline.createdAt,
        updatedAt: outline.updatedAt,
    }
}

// GET /api/outlines/[id] - Get a single outline
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        const outline = await prisma.outline.findUnique({
            where: { id },
            include: { novel: { select: { ownerId: true } } },
        })

        if (!outline || outline.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Outline not found' }, { status: 404 })
        }

        return NextResponse.json(toOutlineResponse(outline))
    } catch (error) {
        console.error('Get outline error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// PUT /api/outlines/[id] - Update an outline
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json().catch(() => ({}))

        const existing = await prisma.outline.findUnique({
            where: { id },
            include: { novel: { select: { ownerId: true } } },
        })

        if (!existing || existing.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Outline not found' }, { status: 404 })
        }

        const data: { content?: string; wordCount?: number; historyJson?: string } = {}
        if (body && typeof body === 'object') {
            if (typeof body.content === 'string') data.content = body.content
        }

        const nextContent = data.content
        if (nextContent !== undefined && nextContent !== existing.content) {
            data.wordCount = calculateWordCountFromHtml(nextContent)

            const now = Date.now()
            const history = safeParseRevisionHistoryJson(existing.historyJson, { idPrefix: 'outline' })
            const { history: nextHistory, recorded } = recordRevisionHistory(history, nextContent, {
                now,
                idPrefix: 'outline',
                normalize: (value) => value.trim(),
            })
            if (recorded) data.historyJson = JSON.stringify(nextHistory)
        }

        const outline = await prisma.outline.update({
            where: { id },
            data,
        })

        if (nextContent !== undefined && nextContent !== existing.content) {
            await syncNovelWorkspaceDetailedOutlines(user.userId, existing.novelId)
        }

        return NextResponse.json(toOutlineResponse(outline))
    } catch (error) {
        console.error('Update outline error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/outlines/[id] - Delete an outline
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params

        const existing = await prisma.outline.findUnique({
            where: { id },
            include: { novel: { select: { ownerId: true } } },
        })

        if (!existing || existing.novel.ownerId !== user.userId) {
            return NextResponse.json({ detail: 'Outline not found' }, { status: 404 })
        }

        await prisma.outline.delete({ where: { id } })
        await syncNovelWorkspaceDetailedOutlines(user.userId, existing.novelId)

        return NextResponse.json({ message: 'Outline deleted successfully' })
    } catch (error) {
        console.error('Delete outline error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
