import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import {
    assembleManuscript,
    buildContentDisposition,
    buildExportFilename,
    NOVEL_EXPORT_FORMATS,
    NOVEL_EXPORT_SCENE_DIVIDERS,
    renderDocx,
    renderTxt,
    type NovelExportFormat,
    type NovelExportSceneDivider,
} from '@/lib/export'

interface RouteParams {
    params: Promise<{ id: string }>
}

function isExportFormat(value: unknown): value is NovelExportFormat {
    return typeof value === 'string' && (NOVEL_EXPORT_FORMATS as readonly string[]).includes(value)
}

function isSceneDivider(value: unknown): value is NovelExportSceneDivider {
    return typeof value === 'string' && (NOVEL_EXPORT_SCENE_DIVIDERS as readonly string[]).includes(value)
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params
        const body = await request.json().catch(() => null)
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 })
        }

        const chapterIds = Array.isArray(body.chapterIds)
            ? body.chapterIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
            : []
        if (chapterIds.length === 0) {
            return NextResponse.json({ detail: 'Select at least one chapter' }, { status: 400 })
        }

        if (!isExportFormat(body.format)) {
            return NextResponse.json({ detail: 'Unsupported export format' }, { status: 400 })
        }

        const includeActTitles = body.includeActTitles !== false
        const sceneDivider = isSceneDivider(body.sceneDivider) ? body.sceneDivider : 'asterisks'

        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: {
                id: true,
                title: true,
                language: true,
                acts: {
                    select: { number: true, title: true },
                    orderBy: { number: 'asc' },
                },
                chapters: {
                    where: { id: { in: chapterIds } },
                    orderBy: [{ actNumber: 'asc' }, { order: 'asc' }],
                    select: {
                        id: true,
                        title: true,
                        actNumber: true,
                        order: true,
                        scenes: {
                            orderBy: { order: 'asc' },
                            select: { order: true, content: true },
                        },
                    },
                },
            },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }
        if (novel.chapters.length === 0) {
            return NextResponse.json({ detail: 'Select at least one chapter' }, { status: 400 })
        }

        const blocks = assembleManuscript(
            novel.acts,
            novel.chapters,
            novel.chapters.map((chapter) => chapter.id),
            {
                includeActTitles,
                sceneDivider,
                language: novel.language || 'en',
            },
        )

        const filename = buildExportFilename(novel.title || 'export', body.format)
        if (body.format === 'txt') {
            const text = `\uFEFF${renderTxt(blocks)}`
            return new NextResponse(text, {
                status: 200,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Content-Disposition': buildContentDisposition(filename),
                    'Cache-Control': 'no-store',
                },
            })
        }

        const buffer = await renderDocx(blocks)
        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'Content-Disposition': buildContentDisposition(filename),
                'Cache-Control': 'no-store',
            },
        })
    } catch (error) {
        console.error('Export novel error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
