import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { ensureNovelWorkspace, ensureNovelWorkspaces } from '@/lib/server/novel-workspace'

function getDefaultNovelLanguageFromRequest(request: NextRequest) {
    const acceptLanguage = request.headers.get('accept-language')?.toLowerCase() ?? ''
    if (acceptLanguage.includes('zh')) return 'zh-CN'
    return 'en'
}

// GET /api/novels - Get all novels for current user
export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const novels = await prisma.novel.findMany({
            where: { ownerId: user.userId },
            orderBy: { updatedAt: 'desc' },
            include: {
                _count: {
                    select: { chapters: true },
                },
            },
        })
        await ensureNovelWorkspaces(user.userId, novels.map((novel) => novel.id))

        return NextResponse.json(novels)
    } catch (error) {
        console.error('Get novels error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/novels - Create a new novel
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const body = await request.json()
        const { title, description, category, coverImage, coverCrop, language } = body

        if (!title) {
            return NextResponse.json({ detail: 'Title is required' }, { status: 400 })
        }

        const resolvedLanguage = typeof language === 'string' && language.trim()
            ? language.trim()
            : getDefaultNovelLanguageFromRequest(request)

        const novel = await prisma.novel.create({
            data: {
                title,
                description: description || null,
                category: category || null,
                coverImage: coverImage || null,
                coverCrop: (coverImage && coverCrop) || null,
                language: resolvedLanguage,
                ownerId: user.userId,
            },
        })
        await ensureNovelWorkspace(user.userId, novel.id)

        return NextResponse.json(novel, { status: 201 })
    } catch (error) {
        console.error('Create novel error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
