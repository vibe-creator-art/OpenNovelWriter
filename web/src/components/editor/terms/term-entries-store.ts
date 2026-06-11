import { create } from 'zustand'
import type {
    CustomTermCategory,
    PresetTermCategoryId,
    TermEntry,
    TermEntryGalleryItem,
} from '@/components/editor/terms/types'

export type TermEntriesLoadStatus = 'idle' | 'loading' | 'loaded' | 'error'

export type TermEntriesMeta = {
    customCategories: CustomTermCategory[]
    enabledPresetCategoryIds: PresetTermCategoryId[]
}

type TermEntriesStoreState = {
    entriesByNovelId: Record<string, TermEntry[]>
    statusByNovelId: Record<string, TermEntriesLoadStatus | undefined>
    metaByNovelId: Record<string, TermEntriesMeta | undefined>
    setEntries: (novelId: string, entries: TermEntry[]) => void
    setStatus: (novelId: string, status: TermEntriesLoadStatus) => void
    setMeta: (novelId: string, meta: TermEntriesMeta) => void
    resetNovel: (novelId: string) => void
}

export const useTermEntriesStore = create<TermEntriesStoreState>((set) => ({
    entriesByNovelId: {},
    statusByNovelId: {},
    metaByNovelId: {},
    setEntries: (novelId, entries) =>
        set((state) => ({
            entriesByNovelId: { ...state.entriesByNovelId, [novelId]: entries },
        })),
    setStatus: (novelId, status) =>
        set((state) => ({
            statusByNovelId: { ...state.statusByNovelId, [novelId]: status },
        })),
    setMeta: (novelId, meta) =>
        set((state) => ({
            metaByNovelId: { ...state.metaByNovelId, [novelId]: meta },
        })),
    resetNovel: (novelId) =>
        set((state) => {
            const entriesByNovelId = { ...state.entriesByNovelId }
            const statusByNovelId = { ...state.statusByNovelId }
            const metaByNovelId = { ...state.metaByNovelId }
            delete entriesByNovelId[novelId]
            delete statusByNovelId[novelId]
            delete metaByNovelId[novelId]
            return { entriesByNovelId, statusByNovelId, metaByNovelId }
        }),
}))

export const TERM_GALLERY_UPDATED_EVENT = 'onw:term-gallery-updated'

export type TermGalleryUpdatedDetail = {
    novelId: string
    entryId: string
    gallery: TermEntryGalleryItem[]
}

/**
 * Propagate a server-side gallery append (made from the chat / codex panels)
 * to every client copy of the term state: the shared read store here, plus —
 * via a window event — the terms sidebar controller's local state when it is
 * mounted, so its next whole-state save does not clobber the new item.
 */
export function applyTermGalleryUpdate(detail: TermGalleryUpdatedDetail) {
    const { entriesByNovelId, setEntries } = useTermEntriesStore.getState()
    const entries = entriesByNovelId[detail.novelId]
    if (entries) {
        setEntries(
            detail.novelId,
            entries.map((entry) => (entry.id === detail.entryId ? { ...entry, gallery: detail.gallery } : entry))
        )
    }
    window.dispatchEvent(new CustomEvent<TermGalleryUpdatedDetail>(TERM_GALLERY_UPDATED_EVENT, { detail }))
}
