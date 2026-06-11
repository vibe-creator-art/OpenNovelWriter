export const NOVEL_REFRESH_REQUESTED_EVENT = 'onw:novel-refresh-requested'

export type NovelRefreshRequestedEventDetail = {
    novelId: string
    source: 'codex'
}

export function dispatchNovelRefreshRequested(detail: NovelRefreshRequestedEventDetail) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<NovelRefreshRequestedEventDetail>(NOVEL_REFRESH_REQUESTED_EVENT, { detail }))
}
