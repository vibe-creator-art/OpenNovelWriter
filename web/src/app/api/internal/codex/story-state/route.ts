import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { isValidCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { syncNovelWorkspaceStoryState } from '@/lib/server/novel-workspace'
import {
    STORY_ALIAS_SOURCE_KINDS,
    STORY_ENTITY_KINDS,
    addStoryEntityAlias,
    assertManualStoryEpisode,
    createStoryMoment,
    deleteStoryEntity,
    deleteStoryEntityAlias,
    deleteStoryMoment,
    listOutdatedStoryEpisodes,
    mergeStoryEntities,
    normalizeStoryName,
    queryCredibleStoryFacts,
    retractManualStoryEpisode,
    syncSceneStoryEpisode,
    upsertStoryEntity,
} from '@/lib/server/story-state'

const INTERNAL_TOKEN_HEADER = 'x-onw-internal-token'
const id = z.string().trim().min(1)
const optionalId = id.nullable().optional()
const existingFactSchema = z.object({ factId: id }).strict()
const newFactSchema = z.object({
    subjectEntityId: id,
    predicateKey: z.string().trim().min(1),
    objectEntityId: optionalId,
    objectValue: z.string().trim().min(1).nullable().optional(),
    factText: z.string().trim().min(1),
    validFromMomentId: optionalId,
    validToMomentId: optionalId,
}).strict()
const factSchema = z.union([existingFactSchema, newFactSchema])
const closeFactSchema = z.object({ factId: id, validToMomentId: id }).strict()
const episodePlanFields = {
    referenceMomentId: optionalId,
    facts: z.array(factSchema).default([]),
    closeFacts: z.array(closeFactSchema).optional(),
    invalidateFactIds: z.array(id).optional(),
}

function parseAction<T extends z.ZodType>(schema: T, body: unknown) {
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
        throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '))
    }
    return parsed.data as z.infer<T>
}

async function syncProjection(ownerId: string, novelId: string) {
    await syncNovelWorkspaceStoryState(ownerId, novelId)
}

export async function POST(request: NextRequest) {
    if (!isValidCodexInternalToken(request.headers.get(INTERNAL_TOKEN_HEADER))) {
        return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const action = typeof body?.action === 'string' ? body.action : ''

    try {
        if (action === 'refresh_projection') {
            const input = parseAction(z.object({
                action: z.literal('refresh_projection'),
                ownerId: id,
                novelId: id,
            }).strict(), body)
            const novel = await prisma.novel.findFirst({
                where: { id: input.novelId, ownerId: input.ownerId },
                select: { id: true },
            })
            if (!novel) throw new Error('Novel not found.')
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true })
        }

        if (action === 'create_moment') {
            const input = parseAction(z.object({
                action: z.literal('create_moment'),
                ownerId: id,
                novelId: id,
                label: z.string().trim().min(1),
                afterMomentId: optionalId,
                sourceSceneId: optionalId,
            }).strict(), body)
            const moment = await createStoryMoment(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, moment })
        }

        if (action === 'delete_moment') {
            const input = parseAction(z.object({
                action: z.literal('delete_moment'),
                ownerId: id,
                novelId: id,
                momentId: id,
            }).strict(), body)
            const moment = await deleteStoryMoment(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, moment })
        }

        if (action === 'upsert_entity') {
            const input = parseAction(z.object({
                action: z.literal('upsert_entity'),
                ownerId: id,
                novelId: id,
                entityId: optionalId,
                name: z.string().trim().min(1),
                kind: z.enum(STORY_ENTITY_KINDS),
                summary: z.string().nullable().optional(),
                termId: optionalId,
            }).strict(), body)
            const entity = await upsertStoryEntity(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, entity })
        }

        if (action === 'add_alias') {
            const input = parseAction(z.object({
                action: z.literal('add_alias'),
                ownerId: id,
                novelId: id,
                entityId: id,
                alias: z.string().trim().min(1),
                sourceKind: z.enum(STORY_ALIAS_SOURCE_KINDS),
            }).strict(), body)
            const alias = await addStoryEntityAlias(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, alias })
        }

        if (action === 'merge_entities') {
            const input = parseAction(z.object({
                action: z.literal('merge_entities'),
                ownerId: id,
                novelId: id,
                fromEntityId: id,
                intoEntityId: id,
            }).strict(), body)
            const entity = await mergeStoryEntities(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, entity })
        }

        if (action === 'delete_entity') {
            const input = parseAction(z.object({
                action: z.literal('delete_entity'),
                ownerId: id,
                novelId: id,
                entityId: id,
            }).strict(), body)
            const entity = await deleteStoryEntity(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, entity })
        }

        if (action === 'delete_alias') {
            const input = parseAction(z.object({
                action: z.literal('delete_alias'),
                ownerId: id,
                novelId: id,
                aliasId: id,
            }).strict(), body)
            const alias = await deleteStoryEntityAlias(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, alias })
        }

        if (action === 'sync_scene_episode') {
            const input = parseAction(z.object({
                action: z.literal('sync_scene_episode'),
                ownerId: id,
                novelId: id,
                sceneId: id,
                ...episodePlanFields,
            }).strict(), body)
            const result = await syncSceneStoryEpisode(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, ...result })
        }

        if (action === 'assert_manual') {
            const input = parseAction(z.object({
                action: z.literal('assert_manual'),
                ownerId: id,
                novelId: id,
                content: z.string().trim().min(1),
                ...episodePlanFields,
            }).strict(), body)
            const result = await assertManualStoryEpisode(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, ...result })
        }

        if (action === 'retract_manual') {
            const input = parseAction(z.object({
                action: z.literal('retract_manual'),
                ownerId: id,
                novelId: id,
                episodeId: id,
            }).strict(), body)
            const episode = await retractManualStoryEpisode(prisma, input)
            await syncProjection(input.ownerId, input.novelId)
            return NextResponse.json({ ok: true, episode })
        }

        if (action === 'query') {
            const input = parseAction(z.object({
                action: z.literal('query'),
                ownerId: id,
                novelId: id,
                query: z.string().trim().optional(),
                entityId: optionalId,
                predicateKey: z.string().trim().optional(),
                targetMomentId: optionalId,
                includeHistory: z.boolean().optional(),
            }).strict(), body)
            const normalizedQuery = input.query ? normalizeStoryName(input.query) : ''
            const [moments, entities, facts, outdatedEpisodes] = await Promise.all([
                prisma.storyMoment.findMany({
                    where: { novelId: input.novelId, novel: { ownerId: input.ownerId } },
                    orderBy: { storyOrder: 'asc' },
                }),
                prisma.storyEntity.findMany({
                    where: {
                        novelId: input.novelId,
                        novel: { ownerId: input.ownerId },
                        ...(normalizedQuery
                            ? {
                                  OR: [
                                      { normalizedName: { contains: normalizedQuery } },
                                      { aliases: { some: { normalizedAlias: { contains: normalizedQuery } } } },
                                  ],
                              }
                            : {}),
                    },
                    include: { aliases: { orderBy: { createdAt: 'asc' } } },
                    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
                    take: normalizedQuery ? 50 : 200,
                }),
                queryCredibleStoryFacts(prisma, input),
                listOutdatedStoryEpisodes(prisma, input),
            ])
            return NextResponse.json({ ok: true, moments, entities, facts, outdatedEpisodes })
        }

        return NextResponse.json({ detail: 'Unknown story-state action.' }, { status: 400 })
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Story-state request failed.'
        const status = detail === 'Novel not found.' ? 404 : 400
        console.error('Codex story-state request failed:', error)
        return NextResponse.json({ detail }, { status })
    }
}
