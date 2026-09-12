'use client'

import { useEffect, useState } from 'react'
import { novelApi } from '@/lib/api'
import { NOVEL_SETTINGS_CHANGED_EVENT, type NovelSettingsChangedDetail } from '@/lib/novel-settings-events'

export function useCodexNovelSettings(novelId: string | undefined) {
    const [settings, setSettings] = useState<{
        novelId: string
        showReasoning: boolean
        customFastModeEnabled: boolean
    } | null>(null)
    useEffect(() => {
        if (!novelId) return
        let revision = 0
        let disposed = false
        const refresh = async () => {
            const requestedRevision = ++revision
            try {
                const novel = await novelApi.get(novelId)
                if (!disposed && revision === requestedRevision) setSettings({
                    novelId,
                    showReasoning: novel.codexShowReasoning,
                    customFastModeEnabled: novel.codexCustomFastModeEnabled,
                })
            } catch (error) {
                console.error('Failed to load Codex novel settings:', error)
            }
        }
        const onSettingsChanged = (event: Event) => {
            if ((event as CustomEvent<NovelSettingsChangedDetail>).detail.novelId === novelId) void refresh()
        }
        void refresh()
        window.addEventListener(NOVEL_SETTINGS_CHANGED_EVENT, onSettingsChanged)
        return () => {
            disposed = true
            window.removeEventListener(NOVEL_SETTINGS_CHANGED_EVENT, onSettingsChanged)
        }
    }, [novelId])
    return {
        showReasoning: settings?.novelId === novelId && settings?.showReasoning === true,
        customFastModeEnabled: settings?.novelId === novelId && settings?.customFastModeEnabled === true,
    }
}
