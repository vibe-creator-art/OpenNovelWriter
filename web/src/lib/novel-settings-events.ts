export const NOVEL_SETTINGS_CHANGED_EVENT = 'onw:novel-settings-changed'

export type NovelSettingsChangedDetail = {
    novelId: string
}

export function dispatchNovelSettingsChanged(detail: NovelSettingsChangedDetail) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<NovelSettingsChangedDetail>(NOVEL_SETTINGS_CHANGED_EVENT, { detail }))
}
