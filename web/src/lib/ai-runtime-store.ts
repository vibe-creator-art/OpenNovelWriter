import { create } from 'zustand'
import type { ModelAssignment } from '@/lib/ai-store'

export type AssignmentRuntimeOverride = Partial<
    Pick<ModelAssignment, 'failureCount' | 'ignoredUntil' | 'manuallyDisabled'>
>

type AiRuntimeState = {
    assignmentOverridesById: Record<string, AssignmentRuntimeOverride>
    applyAssignmentOverride: (assignmentId: string, updates: AssignmentRuntimeOverride) => void
    clearAssignmentOverride: (assignmentId: string) => void
}

export const useAiRuntimeStore = create<AiRuntimeState>()((set) => ({
    assignmentOverridesById: {},
    applyAssignmentOverride: (assignmentId, updates) =>
        set((state) => ({
            assignmentOverridesById: {
                ...state.assignmentOverridesById,
                [assignmentId]: {
                    ...(state.assignmentOverridesById[assignmentId] ?? {}),
                    ...updates,
                },
            },
        })),
    clearAssignmentOverride: (assignmentId) =>
        set((state) => {
            if (!state.assignmentOverridesById[assignmentId]) return state
            const next = { ...state.assignmentOverridesById }
            delete next[assignmentId]
            return { assignmentOverridesById: next }
        }),
}))

