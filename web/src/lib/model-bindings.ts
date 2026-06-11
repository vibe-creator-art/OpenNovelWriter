import type { ModelGroup, ModelSet } from '@/lib/ai-store'

type ModelBindingSelection = {
    modelGroupIds?: string[] | null
    modelSetIds?: string[] | null
}

type ModelSetLike = Pick<ModelSet, 'id' | 'members'>
type ModelGroupLike = Pick<ModelGroup, 'id' | 'modelTypes'>

export function isModelGroupBindableToLlm(group: Pick<ModelGroup, 'modelTypes'> | null | undefined) {
    return !group?.modelTypes?.reranker && !group?.modelTypes?.embedding
}

export function getLlmBindableModelGroups<T extends ModelGroupLike>(modelGroups: readonly T[]) {
    return modelGroups.filter((group) => isModelGroupBindableToLlm(group))
}

function normalizeIdList(value: string[] | null | undefined) {
    if (!Array.isArray(value)) return []

    const seen = new Set<string>()
    const result: string[] = []
    for (const item of value) {
        if (typeof item !== 'string') continue
        const trimmed = item.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        result.push(trimmed)
    }
    return result
}

function getAllowedMemberGroupIds(
    members: ModelSet['members'] | undefined,
    allowedGroupIds?: ReadonlySet<string>
) {
    const seen = new Set<string>()
    const groupIds: string[] = []
    for (const member of members ?? []) {
        const groupId = typeof member.groupId === 'string' ? member.groupId.trim() : ''
        if (!groupId || seen.has(groupId)) continue
        if (allowedGroupIds && !allowedGroupIds.has(groupId)) continue
        seen.add(groupId)
        groupIds.push(groupId)
    }
    return groupIds
}

export function buildModelSetGroupIdsById(modelSets: readonly ModelSetLike[], allowedGroupIds?: ReadonlySet<string>) {
    const map = new Map<string, string[]>()
    for (const setItem of modelSets) {
        map.set(setItem.id, getAllowedMemberGroupIds(setItem.members, allowedGroupIds))
    }
    return map
}

export function getLlmBindableModelSetIds(modelSets: readonly ModelSetLike[], allowedGroupIds: ReadonlySet<string>) {
    const allowedSetIds = new Set<string>()

    for (const setItem of modelSets) {
        if (getAllowedMemberGroupIds(setItem.members, allowedGroupIds).length > 0) {
            allowedSetIds.add(setItem.id)
        }
    }

    return allowedSetIds
}

export function getPrimaryModelGroupId(modelGroupIds?: readonly string[] | null) {
    if (!Array.isArray(modelGroupIds)) return null
    for (const groupId of modelGroupIds) {
        if (typeof groupId !== 'string') continue
        const trimmed = groupId.trim()
        if (trimmed) return trimmed
    }
    return null
}

export function attachModelGroupSelection(params: {
    selection: ModelBindingSelection
    groupId: string
    modelSets: ModelSetLike[]
    modelSetGroupIdsById: Map<string, string[]>
    allowedGroupIds?: ReadonlySet<string>
    allowedSetIds?: ReadonlySet<string>
}) {
    const groupId = params.groupId.trim()
    const modelGroupIds = normalizeIdList(params.selection.modelGroupIds)
    const modelSetIds = normalizeIdList(params.selection.modelSetIds)
    if (!groupId || modelGroupIds.includes(groupId) || (params.allowedGroupIds && !params.allowedGroupIds.has(groupId))) {
        return { modelGroupIds, modelSetIds, changed: false }
    }

    const nextGroupIds = [...modelGroupIds, groupId]
    const nextSetIds = [...modelSetIds]
    for (const setItem of params.modelSets) {
        if (nextSetIds.includes(setItem.id)) continue
        if (params.allowedSetIds && !params.allowedSetIds.has(setItem.id)) continue
        const memberGroupIds = params.modelSetGroupIdsById.get(setItem.id) ?? []
        if (memberGroupIds.length === 0) continue
        if (memberGroupIds.every((memberId) => nextGroupIds.includes(memberId))) {
            nextSetIds.push(setItem.id)
        }
    }

    return {
        modelGroupIds: nextGroupIds,
        modelSetIds: nextSetIds,
        changed: true,
    }
}

export function attachModelSetSelection(params: {
    selection: ModelBindingSelection
    setId: string
    modelSetGroupIdsById: Map<string, string[]>
    allowedGroupIds?: ReadonlySet<string>
    allowedSetIds?: ReadonlySet<string>
}) {
    const setId = params.setId.trim()
    const modelGroupIds = normalizeIdList(params.selection.modelGroupIds)
    const modelSetIds = normalizeIdList(params.selection.modelSetIds)
    if (!setId || modelSetIds.includes(setId) || (params.allowedSetIds && !params.allowedSetIds.has(setId))) {
        return { modelGroupIds, modelSetIds, changed: false }
    }

    const nextGroupIds = [...modelGroupIds]
    for (const groupId of params.modelSetGroupIdsById.get(setId) ?? []) {
        if (params.allowedGroupIds && !params.allowedGroupIds.has(groupId)) continue
        if (!nextGroupIds.includes(groupId)) nextGroupIds.push(groupId)
    }

    return {
        modelGroupIds: nextGroupIds,
        modelSetIds: [...modelSetIds, setId],
        changed: true,
    }
}

export function detachModelSetSelection(params: {
    selection: ModelBindingSelection
    setId: string
    modelSetGroupIdsById: Map<string, string[]>
}) {
    const setId = params.setId.trim()
    const modelGroupIds = normalizeIdList(params.selection.modelGroupIds)
    const modelSetIds = normalizeIdList(params.selection.modelSetIds)
    if (!setId || !modelSetIds.includes(setId)) {
        return { modelGroupIds, modelSetIds, changed: false }
    }

    const remainingSetIds = modelSetIds.filter((item) => item !== setId)
    const removedGroupIds = new Set(params.modelSetGroupIdsById.get(setId) ?? [])
    const keepGroupIds = new Set<string>()
    for (const remainingSetId of remainingSetIds) {
        for (const groupId of params.modelSetGroupIdsById.get(remainingSetId) ?? []) {
            keepGroupIds.add(groupId)
        }
    }

    return {
        modelGroupIds: modelGroupIds.filter((groupId) => !removedGroupIds.has(groupId) || keepGroupIds.has(groupId)),
        modelSetIds: remainingSetIds,
        changed: true,
    }
}

export function detachModelGroupSelection(params: {
    selection: ModelBindingSelection
    groupId: string
    modelSetGroupIdsById: Map<string, string[]>
}) {
    const groupId = params.groupId.trim()
    const modelGroupIds = normalizeIdList(params.selection.modelGroupIds)
    const modelSetIds = normalizeIdList(params.selection.modelSetIds)
    if (!groupId || !modelGroupIds.includes(groupId)) {
        return { modelGroupIds, modelSetIds, changed: false }
    }

    return {
        modelGroupIds: modelGroupIds.filter((item) => item !== groupId),
        modelSetIds: modelSetIds.filter((setId) => !(params.modelSetGroupIdsById.get(setId) ?? []).includes(groupId)),
        changed: true,
    }
}

export function setPrimaryModelGroupSelection(params: {
    selection: ModelBindingSelection
    groupId: string
}) {
    const groupId = params.groupId.trim()
    const modelGroupIds = normalizeIdList(params.selection.modelGroupIds)
    const modelSetIds = normalizeIdList(params.selection.modelSetIds)
    if (!groupId) {
        return { modelGroupIds, modelSetIds, changed: false }
    }

    const currentIndex = modelGroupIds.indexOf(groupId)
    if (currentIndex <= 0) {
        return { modelGroupIds, modelSetIds, changed: false }
    }

    return {
        modelGroupIds: [groupId, ...modelGroupIds.filter((item) => item !== groupId)],
        modelSetIds,
        changed: true,
    }
}

export function syncModelBindingSelection(params: {
    selection: ModelBindingSelection
    modelSetGroupIdsById: Map<string, string[]>
    allowedGroupIds?: ReadonlySet<string>
    allowedSetIds?: ReadonlySet<string>
}) {
    const modelGroupIds = normalizeIdList(params.selection.modelGroupIds)
    const modelSetIds = normalizeIdList(params.selection.modelSetIds)

    const nextGroupIds = params.allowedGroupIds
        ? modelGroupIds.filter((groupId) => params.allowedGroupIds?.has(groupId))
        : [...modelGroupIds]
    const nextSetIds = params.allowedSetIds
        ? modelSetIds.filter((setId) => params.allowedSetIds?.has(setId))
        : [...modelSetIds]

    let addedGroupCount = 0
    for (const setId of nextSetIds) {
        for (const groupId of params.modelSetGroupIdsById.get(setId) ?? []) {
            if (params.allowedGroupIds && !params.allowedGroupIds.has(groupId)) continue
            if (nextGroupIds.includes(groupId)) continue
            nextGroupIds.push(groupId)
            addedGroupCount += 1
        }
    }

    return {
        modelGroupIds: nextGroupIds,
        modelSetIds: nextSetIds,
        removedGroupCount: modelGroupIds.length - nextGroupIds.filter((groupId) => modelGroupIds.includes(groupId)).length,
        removedSetCount: modelSetIds.length - nextSetIds.length,
        addedGroupCount,
        changed:
            addedGroupCount > 0 ||
            modelGroupIds.length !== nextGroupIds.length ||
            modelSetIds.length !== nextSetIds.length,
    }
}
