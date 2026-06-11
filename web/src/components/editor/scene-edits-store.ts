import { create } from 'zustand'
import { sceneEditApi, type SceneEdit } from '@/lib/api'
import { emitSceneEditsChanged } from '@/components/editor/scene-edit-events'

type SceneEditsState = {
    novelId: string | null
    edits: SceneEdit[]
    refresh: (novelId: string) => Promise<void>
    resolve: (novelId: string, editId: string, action: 'accept' | 'reject') => Promise<{ ok: boolean; error?: string }>
    resolveAll: (novelId: string, action: 'accept-all' | 'reject-all', sceneId?: string) => Promise<void>
    clear: () => void
}

export const useSceneEditsStore = create<SceneEditsState>((set, get) => ({
    novelId: null,
    edits: [],

    refresh: async (novelId) => {
        try {
            const edits = await sceneEditApi.list(novelId, 'pending')
            set({ novelId, edits })
        } catch {
            set({ novelId, edits: [] })
        }
    },

    resolve: async (novelId, editId, action) => {
        try {
            await sceneEditApi.resolve(novelId, editId, action)
            set((state) => ({ edits: state.edits.filter((edit) => edit.id !== editId) }))
            emitSceneEditsChanged(novelId)
            return { ok: true }
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : '操作失败' }
        }
    },

    resolveAll: async (novelId, action, sceneId) => {
        try {
            await sceneEditApi.resolveAll(novelId, action, sceneId)
        } finally {
            await get().refresh(novelId)
            emitSceneEditsChanged(novelId)
        }
    },

    clear: () => set({ novelId: null, edits: [] }),
}))
