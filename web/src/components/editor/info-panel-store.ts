import { create } from 'zustand'
import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'

export type InfoPanelTab = 'preview' | 'codex' | 'chat' | 'materials'

export type InfoPanelPreviewPayload =
    | {
          kind: 'prompt_render'
          sourceId: string
          title: string
          model: InputsEditorModel
      }

type InfoPanelState = {
    activeTab: InfoPanelTab
    preview: InfoPanelPreviewPayload | null
    // Which material doc is open in the Materials tab, per novel. Kept here (not
    // in the tab component) so it survives the component unmounting when the user
    // switches to another tab and comes back.
    materialsOpenId: Record<string, string | null>
    setActiveTab: (tab: InfoPanelTab) => void
    showPreview: (payload: InfoPanelPreviewPayload) => void
    updatePreview: (payload: InfoPanelPreviewPayload) => void
    clearPreview: (sourceId?: string) => void
    setMaterialsOpenId: (novelId: string, id: string | null) => void
}

export const useInfoPanelStore = create<InfoPanelState>()((set, get) => ({
    activeTab: 'preview',
    preview: null,
    materialsOpenId: {},
    setActiveTab: (activeTab) => set({ activeTab }),
    setMaterialsOpenId: (novelId, id) =>
        set((state) => ({ materialsOpenId: { ...state.materialsOpenId, [novelId]: id } })),
    showPreview: (payload) => set({ activeTab: 'preview', preview: payload }),
    updatePreview: (payload) => {
        const current = get().preview
        if (!current) return
        if (current.kind !== payload.kind) return
        if (current.sourceId !== payload.sourceId) return
        if (current.title === payload.title && current.model === payload.model) return
        set({ preview: payload })
    },
    clearPreview: (sourceId) => {
        const current = get().preview
        if (!current) return
        if (sourceId && current.sourceId !== sourceId) return
        set({ preview: null })
    },
}))
