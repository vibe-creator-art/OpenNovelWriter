import { useEffect, useMemo } from 'react'
import type { TermEntry } from '@/components/editor/terms/types'
import { safeParseTerms } from '@/components/editor/terms/utils'
import { termsApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { useTermEntriesStore } from '@/components/editor/terms/term-entries-store'
import {
    NOVEL_REFRESH_REQUESTED_EVENT,
    type NovelRefreshRequestedEventDetail,
} from '@/lib/novel-refresh-events'

// Read-only hook for term entries synced from the server.
// Used outside the terms sidebar (e.g. manuscript mention highlighting).
export function useStoredTermEntries(novelId?: string) {
    const token = useAuthStore((s) => s.token)
    const isHydrated = useAuthStore((s) => s.isHydrated)

    const entries = useTermEntriesStore((s) => (novelId ? s.entriesByNovelId[novelId] : undefined))
    const meta = useTermEntriesStore((s) => (novelId ? s.metaByNovelId[novelId] : undefined))
    const setEntries = useTermEntriesStore((s) => s.setEntries)
    const setStatus = useTermEntriesStore((s) => s.setStatus)
    const setMeta = useTermEntriesStore((s) => s.setMeta)

    useEffect(() => {
        if (!novelId) return
        if (!isHydrated || !token) return

        let canceled = false

        const load = async (force = false) => {
            // Note: In React Strict Mode, effects may mount/unmount twice in dev.
            // Avoid relying on a global "idle/loading" flag here to prevent getting stuck in "loading".
            if (!force && entries !== undefined && meta !== undefined) return

            setStatus(novelId, 'loading')
            try {
                const response = await termsApi.getState(novelId)
                const parsed = safeParseTerms(response.state) ?? { entries: [] }

                if (canceled) return
                setEntries(novelId, parsed.entries ?? [])
                setMeta(novelId, {
                    customCategories: parsed.customCategories ?? [],
                    enabledPresetCategoryIds: parsed.enabledPresetCategoryIds ?? [],
                })
                setStatus(novelId, 'loaded')
            } catch (e) {
                console.error('Failed to load terms:', e)
                if (canceled) return
                setEntries(novelId, [])
                setMeta(novelId, { customCategories: [], enabledPresetCategoryIds: [] })
                setStatus(novelId, 'error')
            }
        }

        void load()

        const handleRefresh = (event: Event) => {
            const detail = (event as CustomEvent<NovelRefreshRequestedEventDetail>).detail
            if (!detail || detail.novelId !== novelId) return
            void load(true)
        }
        window.addEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handleRefresh as EventListener)

        return () => {
            canceled = true
            window.removeEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handleRefresh as EventListener)
        }
    }, [entries, isHydrated, meta, novelId, setEntries, setMeta, setStatus, token])

    return useMemo<TermEntry[]>(() => entries ?? [], [entries])
}
