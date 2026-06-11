import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface RouteParams {
    params: Promise<{ id: string }>
}

type OutlineCreateRequest =
    | { type: 'ACT'; actNumber: number }
    | { type: 'CHAPTER'; chapterId: string }

// GET /api/novels/[id]/outlines - List outlines for a novel
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

        const outlines = await prisma.outline.findMany({
            where: { novelId },
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
            select: {
                id: true,
                type: true,
                actNumber: true,
                chapterId: true,
                wordCount: true,
                novelId: true,
                createdAt: true,
                updatedAt: true,
            },
        })

        return NextResponse.json(outlines)
    } catch (error) {
        console.error('List outlines error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/novels/[id]/outlines - Create or return an outline
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

        const body = (await request.json().catch(() => null)) as OutlineCreateRequest | null
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 })
        }

        if (body.type === 'ACT') {
            const actNumber = typeof body.actNumber === 'number' ? body.actNumber : Number.NaN
            if (!Number.isFinite(actNumber) || !Number.isInteger(actNumber) || actNumber <= 0) {
                return NextResponse.json({ detail: 'Invalid act number' }, { status: 400 })
            }

            const outline = await prisma.outline.upsert({
                where: {
                    novelId_type_actNumber: {
                        novelId,
                        type: 'ACT',
                        actNumber,
                    },
                },
                update: {},
                create: {
                    novelId,
                    type: 'ACT',
                    actNumber,
                    content: '',
                    historyJson: '[]',
                    wordCount: 0,
                },
                select: {
                    id: true,
                    type: true,
                    actNumber: true,
                    chapterId: true,
                    wordCount: true,
                    novelId: true,
                    createdAt: true,
                    updatedAt: true,
                },
            })

            return NextResponse.json(outline, { status: 201 })
        }

        if (body.type === 'CHAPTER') {
            const chapterId = typeof body.chapterId === 'string' ? body.chapterId : ''
            if (!chapterId.trim()) {
                return NextResponse.json({ detail: 'Invalid chapter id' }, { status: 400 })
            }

            const chapter = await prisma.chapter.findUnique({
                where: { id: chapterId },
                select: { id: true, novelId: true, novel: { select: { ownerId: true } } },
            })

            if (!chapter || chapter.novelId !== novelId || chapter.novel.ownerId !== user.userId) {
                return NextResponse.json({ detail: 'Chapter not found' }, { status: 404 })
            }

            const outline = await prisma.outline.upsert({
                where: { chapterId: chapter.id },
                update: {},
                create: {
                    novelId,
                    type: 'CHAPTER',
                    chapterId: chapter.id,
                    content: '',
                    historyJson: '[]',
                    wordCount: 0,
                },
                select: {
                    id: true,
                    type: true,
                    actNumber: true,
                    chapterId: true,
                    wordCount: true,
                    novelId: true,
                    createdAt: true,
                    updatedAt: true,
                },
            })

            return NextResponse.json(outline, { status: 201 })
        }

        return NextResponse.json({ detail: 'Invalid outline type' }, { status: 400 })
    } catch (error) {
        console.error('Create outline error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

