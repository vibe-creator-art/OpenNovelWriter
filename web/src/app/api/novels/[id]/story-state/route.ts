import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { attachEpisodeSyncStatus, annotateStoryFactCredibility } from '@/lib/server/story-state'

type RouteParams = { params: Promise<{ id: string }> }
const VIEWS = ['moments', 'episodes', 'entities', 'aliases', 'facts', 'evidence'] as const
const MAX_ROWS = 500

function contains(query: string) {
    return { contains: query }
}

function parsedStoryOrder(query: string) {
    if (!/^-?\d+$/.test(query)) return null
    const value = Number(query)
    return Number.isSafeInteger(value) ? value : null
}

async function pagedView<Row>(
    query: string,
    countAll: () => Promise<number>,
    countMatched: () => Promise<number>,
    findRows: () => Promise<Row[]>,
) {
    if (!query) {
        const [total, rows] = await Promise.all([countAll(), findRows()])
        return { total, matched: total, rows }
    }
    const [total, matched, rows] = await Promise.all([countAll(), countMatched(), findRows()])
    return { total, matched, rows }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    const { id } = await params
    const viewParam = request.nextUrl.searchParams.get('view') ?? 'moments'
    if (!VIEWS.includes(viewParam as (typeof VIEWS)[number])) {
        return NextResponse.json({ detail: 'Invalid story-state view' }, { status: 400 })
    }
    const view = viewParam as (typeof VIEWS)[number]
    const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''
    const novel = await prisma.novel.findFirst({
        where: { id, ownerId: user.userId },
        select: { id: true },
    })
    if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

    if (view === 'moments') {
        const storyOrder = parsedStoryOrder(query)
        const where = {
            novelId: id,
            ...(query ? {
                OR: [
                    { id: contains(query) },
                    { label: contains(query) },
                    { sourceScene: { chapter: { title: contains(query) } } },
                    ...(storyOrder === null ? [] : [{ storyOrder }]),
                ],
            } : {}),
        }
        const result = await pagedView(
            query,
            () => prisma.storyMoment.count({ where: { novelId: id } }),
            () => prisma.storyMoment.count({ where }),
            () => prisma.storyMoment.findMany({
                where,
                include: {
                    sourceScene: { select: { id: true, chapter: { select: { id: true, title: true } } } },
                    _count: { select: { episodes: true, factsStarting: true, factsEnding: true } },
                },
                orderBy: { storyOrder: 'asc' },
                take: MAX_ROWS,
            }),
        )
        return NextResponse.json({ view, ...result })
    }

    if (view === 'episodes') {
        const where = {
            novelId: id,
            ...(query ? {
                OR: [
                    { id: contains(query) },
                    { content: contains(query) },
                    { sourceKind: contains(query) },
                    { inactiveReason: contains(query) },
                    { referenceMoment: { label: contains(query) } },
                    { sourceScene: { chapter: { title: contains(query) } } },
                ],
            } : {}),
        }
        const result = await pagedView(
            query,
            () => prisma.storyEpisode.count({ where: { novelId: id } }),
            () => prisma.storyEpisode.count({ where }),
            () => prisma.storyEpisode.findMany({
                where,
                include: {
                    sourceScene: { select: { id: true, summary: true, chapter: { select: { id: true, title: true } } } },
                    referenceMoment: { select: { id: true, label: true, storyOrder: true } },
                    _count: { select: { evidence: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: MAX_ROWS,
            }),
        )
        return NextResponse.json({
            view,
            total: result.total,
            matched: result.matched,
            rows: result.rows.map(attachEpisodeSyncStatus),
        })
    }

    if (view === 'entities') {
        const where = {
            novelId: id,
            ...(query ? {
                OR: [
                    { id: contains(query) },
                    { name: contains(query) },
                    { kind: contains(query) },
                    { summary: contains(query) },
                    { aliases: { some: { alias: contains(query) } } },
                ],
            } : {}),
        }
        const result = await pagedView(
            query,
            () => prisma.storyEntity.count({ where: { novelId: id } }),
            () => prisma.storyEntity.count({ where }),
            () => prisma.storyEntity.findMany({
                where,
                include: {
                    aliases: { orderBy: { createdAt: 'asc' } },
                    _count: { select: { subjectFacts: true, objectFacts: true } },
                },
                orderBy: [{ kind: 'asc' }, { name: 'asc' }],
                take: MAX_ROWS,
            }),
        )
        return NextResponse.json({ view, ...result })
    }

    if (view === 'aliases') {
        const where = {
            novelId: id,
            ...(query ? {
                OR: [
                    { id: contains(query) },
                    { alias: contains(query) },
                    { sourceKind: contains(query) },
                    { entity: { name: contains(query) } },
                    { entity: { kind: contains(query) } },
                ],
            } : {}),
        }
        const result = await pagedView(
            query,
            () => prisma.storyEntityAlias.count({ where: { novelId: id } }),
            () => prisma.storyEntityAlias.count({ where }),
            () => prisma.storyEntityAlias.findMany({
                where,
                include: { entity: { select: { id: true, name: true, kind: true } } },
                orderBy: [{ entity: { name: 'asc' } }, { alias: 'asc' }],
                take: MAX_ROWS,
            }),
        )
        return NextResponse.json({ view, ...result })
    }

    if (view === 'facts') {
        const where = {
            novelId: id,
            ...(query ? {
                OR: [
                    { id: contains(query) },
                    { factText: contains(query) },
                    { predicateKey: contains(query) },
                    { objectValue: contains(query) },
                    { subjectEntity: { name: contains(query) } },
                    { objectEntity: { name: contains(query) } },
                    { validFromMoment: { label: contains(query) } },
                    { validToMoment: { label: contains(query) } },
                ],
            } : {}),
        }
        const result = await pagedView(
            query,
            () => prisma.storyFact.count({ where: { novelId: id } }),
            () => prisma.storyFact.count({ where }),
            () => prisma.storyFact.findMany({
                where,
                include: {
                    subjectEntity: { select: { id: true, name: true } },
                    objectEntity: { select: { id: true, name: true } },
                    validFromMoment: { select: { id: true, label: true, storyOrder: true } },
                    validToMoment: { select: { id: true, label: true, storyOrder: true } },
                    evidence: {
                        include: { episode: { select: { id: true, sourceKind: true, contentHash: true, inactiveAt: true, sourceScene: { select: { summary: true } } } } },
                    },
                },
                orderBy: { createdAt: 'desc' },
                take: MAX_ROWS,
            }),
        )
        return NextResponse.json({
            view,
            total: result.total,
            matched: result.matched,
            rows: result.rows.map((fact) => annotateStoryFactCredibility(fact)),
        })
    }

    const where = {
        fact: { novelId: id },
        ...(query ? {
            OR: [
                { role: contains(query) },
                { fact: { id: contains(query) } },
                { fact: { factText: contains(query) } },
                { episode: { id: contains(query) } },
                { episode: { sourceKind: contains(query) } },
                { episode: { content: contains(query) } },
            ],
        } : {}),
    }
    const result = await pagedView(
        query,
        () => prisma.storyFactEvidence.count({ where: { fact: { novelId: id } } }),
        () => prisma.storyFactEvidence.count({ where }),
        () => prisma.storyFactEvidence.findMany({
            where,
            include: {
                fact: { select: { id: true, factText: true } },
                episode: {
                    select: {
                        id: true,
                        sourceKind: true,
                        sourceSceneId: true,
                        contentHash: true,
                        inactiveAt: true,
                        inactiveReason: true,
                        sourceScene: { select: { summary: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: MAX_ROWS,
        }),
    )
    return NextResponse.json({
        view,
        total: result.total,
        matched: result.matched,
        rows: result.rows.map((row) => ({
            ...row,
            episode: attachEpisodeSyncStatus(row.episode),
        })),
    })
}
