import { NextRequest, NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { calculateManuscriptWordCount, getLocalDateKey } from '@/lib/server/manuscript-word-count'

interface RouteParams {
    params: Promise<{ id: string }>
}

const prisma = getPrismaClient({ ensureModel: 'novelWritingDay' })

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { id: novelId } = await params
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: {
                id: true,
                chapters: {
                    select: {
                        id: true,
                        wordCount: true,
                        scenes: { select: { id: true, content: true, wordCount: true } },
                    },
                },
            },
        })
        if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

        // Establish a clean baseline for manuscripts created before daily tracking existed.
        // This recalculation never creates writing-day rows, so old work is not counted as today's writing.
        const sceneUpdates: Array<{ id: string; wordCount: number }> = []
        const chapterUpdates: Array<{ id: string; wordCount: number }> = []
        let totalWordCount = 0
        for (const chapter of novel.chapters) {
            let chapterWordCount = 0
            for (const scene of chapter.scenes) {
                const wordCount = calculateManuscriptWordCount(scene.content)
                chapterWordCount += wordCount
                if (wordCount !== scene.wordCount) sceneUpdates.push({ id: scene.id, wordCount })
            }
            totalWordCount += chapterWordCount
            if (chapterWordCount !== chapter.wordCount) chapterUpdates.push({ id: chapter.id, wordCount: chapterWordCount })
        }

        if (sceneUpdates.length > 0 || chapterUpdates.length > 0) {
            await prisma.$transaction([
                ...sceneUpdates.map((item) => prisma.scene.update({ where: { id: item.id }, data: { wordCount: item.wordCount } })),
                ...chapterUpdates.map((item) => prisma.chapter.update({ where: { id: item.id }, data: { wordCount: item.wordCount } })),
            ])
        }

        const days = await prisma.novelWritingDay.findMany({
            where: { novelId },
            orderBy: { dateKey: 'desc' },
            select: { dateKey: true, netWordCount: true, endingWordCount: true },
        })
        const today = days.find((day) => day.dateKey === getLocalDateKey())

        return NextResponse.json({
            totalWordCount,
            todayWordCount: today?.netWordCount ?? 0,
            days,
        })
    } catch (error) {
        console.error('Get novel review data error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
