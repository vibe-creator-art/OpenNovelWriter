import { create } from 'zustand'
import type { CherryStudioDetectionState } from '@/lib/cherrystudio-model-config'

export type ProviderType = 'openai-chat' | 'openai-image' | 'gemini'

export interface AiModel {
    id: string
    name: string
}

export interface AiConnection {
    id: string
    name: string
    providerType: ProviderType
    baseUrl?: string
    isActive: boolean
    models: AiModel[]
    lastFetchedAt?: string
}

export interface PricingTier {
    id: string
    contextTokensUpTo: number | null
    inputPerM: number
    outputPerM: number
}

export interface ModelAssignment {
    id: string
    connectionId: string
    modelId: string
    failureCount: number
    ignoredUntil: string | null
    manuallyDisabled: boolean
}

export type ModelTypeState = CherryStudioDetectionState

export interface ModelGroupSettings {
    strategy: 'priority' | 'round-robin'
    stream: boolean
    temperature: number | null
    maxTokens: number | null
}

export interface FailurePolicy {
    maxFailures: number
    resetDays: number
}

export interface ModelSetMember {
    id?: string
    groupId: string
}

export interface ModelSet {
    id: string
    name: string
    fixed: boolean
    members: ModelSetMember[]
}

export interface ModelGroup {
    id: string
    name: string
    fixed: boolean
    assignments: ModelAssignment[]
    modelTypes: ModelTypeState | null
    settings: ModelGroupSettings
    failurePolicy: FailurePolicy
    pricingTiers: PricingTier[]
}

interface AiState {
    connections: AiConnection[]
    groups: ModelGroup[]
    sets: ModelSet[]
    setConnections: (connections: AiConnection[]) => void
    setGroups: (groups: ModelGroup[]) => void
    setSets: (sets: ModelSet[]) => void
    addConnection: (connection: AiConnection) => void
    upsertConnection: (connection: AiConnection) => void
    updateConnection: (id: string, updates: Partial<AiConnection>) => void
    removeConnection: (id: string) => void
    setConnectionModels: (id: string, models: AiModel[]) => void
    addGroup: (group: ModelGroup) => void
    updateGroup: (id: string, updates: Partial<ModelGroup>) => void
    removeGroup: (id: string) => void
    setGroupAssignments: (groupId: string, assignments: ModelAssignment[]) => void
    addAssignmentToGroup: (groupId: string, assignment: ModelAssignment) => void
    updateAssignment: (groupId: string, assignmentId: string, updates: Partial<ModelAssignment>) => void
    addSet: (set: ModelSet) => void
    updateSet: (id: string, updates: Partial<ModelSet>) => void
    removeSet: (id: string) => void
    setSetMembers: (setId: string, members: ModelSetMember[]) => void
}

export const createId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const useAiStore = create<AiState>()((set) => ({
    connections: [],
    groups: [],
    sets: [],
    setConnections: (connections) => set(() => ({ connections })),
    setGroups: (groups) => set(() => ({ groups })),
    setSets: (sets) => set(() => ({ sets })),
    addConnection: (connection) =>
        set((state) => ({
            connections: [...(Array.isArray(state.connections) ? state.connections : []), connection],
        })),
    upsertConnection: (connection) =>
        set((state) => {
            const existing = Array.isArray(state.connections) ? state.connections : []
            const index = existing.findIndex((item) => item.id === connection.id)
            if (index === -1) {
                return { connections: [...existing, connection] }
            }
            const next = [...existing]
            next[index] = { ...next[index], ...connection }
            return { connections: next }
        }),
    updateConnection: (id, updates) =>
        set((state) => ({
            connections: (Array.isArray(state.connections) ? state.connections : []).map((connection) =>
                connection.id === id ? { ...connection, ...updates } : connection
            ),
        })),
    removeConnection: (id) =>
        set((state) => ({
            connections: (Array.isArray(state.connections) ? state.connections : []).filter(
                (connection) => connection.id !== id
            ),
            groups: (Array.isArray(state.groups) ? state.groups : []).map((group) => ({
                ...group,
                assignments: group.assignments.filter((assignment) => assignment.connectionId !== id),
            })),
        })),
    setConnectionModels: (id, models) =>
        set((state) => ({
            connections: (Array.isArray(state.connections) ? state.connections : []).map((connection) =>
                connection.id === id
                    ? {
                        ...connection,
                        models,
                        isActive: true,
                        lastFetchedAt: new Date().toISOString(),
                    }
                    : connection
            ),
        })),
    addGroup: (group) =>
        set((state) => ({
            groups: [...(Array.isArray(state.groups) ? state.groups : []), group],
        })),
    updateGroup: (id, updates) =>
        set((state) => ({
            groups: (Array.isArray(state.groups) ? state.groups : []).map((group) =>
                group.id === id ? { ...group, ...updates } : group
            ),
        })),
    removeGroup: (id) =>
        set((state) => ({
            groups: (Array.isArray(state.groups) ? state.groups : []).filter((group) => group.id !== id),
        })),
    setGroupAssignments: (groupId, assignments) =>
        set((state) => ({
            groups: (Array.isArray(state.groups) ? state.groups : []).map((group) =>
                group.id === groupId ? { ...group, assignments } : group
            ),
        })),
    addAssignmentToGroup: (groupId, assignment) =>
        set((state) => ({
            groups: (Array.isArray(state.groups) ? state.groups : []).map((group) => {
                if (group.id !== groupId) return group
                const exists = group.assignments.some(
                    (item) => item.connectionId === assignment.connectionId && item.modelId === assignment.modelId
                )
                if (exists) return group
                return {
                    ...group,
                    assignments: [...group.assignments, assignment],
                }
            }),
        })),
    updateAssignment: (groupId, assignmentId, updates) =>
        set((state) => ({
            groups: (Array.isArray(state.groups) ? state.groups : []).map((group) => {
                if (group.id !== groupId) return group
                return {
                    ...group,
                    assignments: group.assignments.map((assignment) =>
                        assignment.id === assignmentId ? { ...assignment, ...updates } : assignment
                    ),
                }
            }),
        })),
    addSet: (setItem) =>
        set((state) => ({
            sets: [...(Array.isArray(state.sets) ? state.sets : []), setItem],
        })),
    updateSet: (id, updates) =>
        set((state) => ({
            sets: (Array.isArray(state.sets) ? state.sets : []).map((setItem) =>
                setItem.id === id ? { ...setItem, ...updates } : setItem
            ),
        })),
    removeSet: (id) =>
        set((state) => ({
            sets: (Array.isArray(state.sets) ? state.sets : []).filter((setItem) => setItem.id !== id),
        })),
    setSetMembers: (setId, members) =>
        set((state) => ({
            sets: (Array.isArray(state.sets) ? state.sets : []).map((setItem) =>
                setItem.id === setId ? { ...setItem, members } : setItem
            ),
        })),
}))
