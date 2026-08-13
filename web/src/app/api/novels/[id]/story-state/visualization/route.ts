import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { attachEpisodeSyncStatus, annotateStoryFactCredibility } from '@/lib/server/story-state'

type RouteParams = { params: Promise<{ id: string }> }

const sceneSourceSelect = {
    id: true,
    order: true,
    chapter: { select: { id: true, title: true, actNumber: true, order: true } },
} as const

export async function GET(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const { id } = await params
    const novel = await prisma.novel.findFirst({
        where: { id, ownerId: user.userId },
        select: { id: true },
    })
    if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

    const [moments, entities, episodes, facts] = await Promise.all([
        prisma.storyMoment.findMany({
            where: { novelId: id },
            select: {
                id: true,
                label: true,
                storyOrder: true,
                sourceScene: { select: sceneSourceSelect },
            },
            orderBy: { storyOrder: 'asc' },
        }),
        prisma.storyEntity.findMany({
            where: { novelId: id },
            select: {
                id: true,
                name: true,
                kind: true,
                summary: true,
                aliases: {
                    select: { id: true, alias: true, sourceKind: true },
                    orderBy: { createdAt: 'asc' },
                },
            },
            orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        }),
        prisma.storyEpisode.findMany({
            where: { novelId: id },
            select: {
                id: true,
                sourceKind: true,
                content: true,
                referenceMomentId: true,
                replacesEpisodeId: true,
                inactiveAt: true,
                inactiveReason: true,
                contentHash: true,
                createdAt: true,
                sourceScene: { select: { ...sceneSourceSelect, summary: true } },
            },
            orderBy: { createdAt: 'asc' },
        }),
        prisma.storyFact.findMany({
            where: { novelId: id },
            select: {
                id: true,
                subjectEntityId: true,
                predicateKey: true,
                objectEntityId: true,
                objectValue: true,
                factText: true,
                validFromMomentId: true,
                validToMomentId: true,
                evidence: {
                    select: {
                        role: true,
                        episodeId: true,
                        episode: {
                            select: {
                                sourceKind: true,
                                inactiveAt: true,
                                contentHash: true,
                                sourceScene: { select: { summary: true } },
                            },
                        },
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
            orderBy: { createdAt: 'asc' },
        }),
    ])

    return NextResponse.json({
        moments,
        entities,
        episodes: episodes.map(attachEpisodeSyncStatus),
        facts: facts.map((fact) => {
            const annotated = annotateStoryFactCredibility(fact)
            return {
                id: annotated.id,
                subjectEntityId: annotated.subjectEntityId,
                predicateKey: annotated.predicateKey,
                objectEntityId: annotated.objectEntityId,
                objectValue: annotated.objectValue,
                factText: annotated.factText,
                validFromMomentId: annotated.validFromMomentId,
                validToMomentId: annotated.validToMomentId,
                credible: annotated.credible,
                staleCredible: annotated.staleCredible,
                evidence: annotated.evidence.map((evidence) => ({
                    episodeId: evidence.episodeId,
                    role: evidence.role,
                })),
            }
        }),
    })
}
