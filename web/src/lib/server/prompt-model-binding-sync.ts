import { prisma } from '@/lib/db'
import { normalizeGroupModelTypes } from '@/lib/ai-group-config'
import {
    buildModelSetGroupIdsById,
    getLlmBindableModelGroups,
    syncModelBindingSelection,
} from '@/lib/model-bindings'

export type PromptModelBindingCatalog = {
    allowedGroupIds: Set<string>
    modelSetGroupIdsById: Map<string, string[]>
}

function parseJson(value: string | null | undefined): unknown {
    if (!value) return null
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

function parseStoredIdList(value: string | null | undefined): string[] {
    if (!value) return []
    try {
        const parsed = JSON.parse(value) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.filter((item): item is string => typeof item === 'string')
    } catch {
        return []
    }
}

export async function loadPromptModelBindingCatalog(ownerId: string): Promise<PromptModelBindingCatalog> {
    const [groups, sets] = await Promise.all([
        prisma.aiModelGroup.findMany({
            where: { ownerId },
            select: {
                id: true,
                modelTypesJson: true,
                assignments: { select: { modelId: true } },
            },
        }),
        prisma.aiModelSet.findMany({
            where: { ownerId },
            select: {
                id: true,
                members: {
                    select: { groupId: true },
                    orderBy: { sortOrder: 'asc' },
                },
            },
        }),
    ])

    const allowedGroupIds = new Set(
        getLlmBindableModelGroups(
            groups.map((group) => ({
                id: group.id,
                modelTypes: normalizeGroupModelTypes(parseJson(group.modelTypesJson)),
                assignments: group.assignments,
            }))
        ).map((group) => group.id)
    )

    return {
        allowedGroupIds,
        modelSetGroupIdsById: buildModelSetGroupIdsById(sets, allowedGroupIds),
    }
}

export async function collectPromptModelBindingUpdates(params: {
    ownerId: string
    previousModelSetGroupIdsById: Map<string, string[]>
    allowedGroupIds: ReadonlySet<string>
    modelSetGroupIdsById: Map<string, string[]>
}) {
    const prompts = await prisma.prompt.findMany({
        where: { ownerId: params.ownerId },
        select: { id: true, modelGroupIdsJson: true, modelSetIdsJson: true },
    })

    const updates: { id: string; modelGroupIdsJson: string; modelSetIdsJson: string }[] = []
    for (const prompt of prompts) {
        const next = syncModelBindingSelection({
            selection: {
                modelGroupIds: parseStoredIdList(prompt.modelGroupIdsJson),
                modelSetIds: parseStoredIdList(prompt.modelSetIdsJson),
            },
            modelSetGroupIdsById: params.modelSetGroupIdsById,
            previousModelSetGroupIdsById: params.previousModelSetGroupIdsById,
            allowedGroupIds: params.allowedGroupIds,
        })
        if (!next.changed) continue
        updates.push({
            id: prompt.id,
            modelGroupIdsJson: JSON.stringify(next.modelGroupIds),
            modelSetIdsJson: JSON.stringify(next.modelSetIds),
        })
    }
    return updates
}

export function catalogAfterDeletingGroup(catalog: PromptModelBindingCatalog, groupId: string): PromptModelBindingCatalog {
    const allowedGroupIds = new Set([...catalog.allowedGroupIds].filter((id) => id !== groupId))
    const modelSetGroupIdsById = new Map(
        [...catalog.modelSetGroupIdsById].map(([setId, members]) => [
            setId,
            members.filter((memberId) => memberId !== groupId),
        ])
    )
    return { allowedGroupIds, modelSetGroupIdsById }
}

export function catalogAfterUpdatingSetMembers(
    catalog: PromptModelBindingCatalog,
    setId: string,
    memberGroupIds: string[]
): PromptModelBindingCatalog {
    const modelSetGroupIdsById = new Map(catalog.modelSetGroupIdsById)
    const seen = new Set<string>()
    const nextMembers: string[] = []
    for (const groupId of memberGroupIds) {
        const trimmed = groupId.trim()
        if (!trimmed || seen.has(trimmed) || !catalog.allowedGroupIds.has(trimmed)) continue
        seen.add(trimmed)
        nextMembers.push(trimmed)
    }
    modelSetGroupIdsById.set(setId, nextMembers)
    return { allowedGroupIds: catalog.allowedGroupIds, modelSetGroupIdsById }
}

export function catalogAfterDeletingSet(catalog: PromptModelBindingCatalog, setId: string): PromptModelBindingCatalog {
    const modelSetGroupIdsById = new Map(catalog.modelSetGroupIdsById)
    modelSetGroupIdsById.delete(setId)
    return { allowedGroupIds: catalog.allowedGroupIds, modelSetGroupIdsById }
}
