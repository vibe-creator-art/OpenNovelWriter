export const NOVEL_OUTLINE_DATA_CHANGED_EVENT = 'onw:novel-outline-data-changed'

export type NovelOutlineDataChangedDetail = {
    novelId: string
}

// Fired when act/scene titles or summaries change so derived previews (e.g. the prompt
// outline preview, which keeps its own fetched copy of acts/chapters) can re-pull. Kept
// separate from NOVEL_REFRESH_REQUESTED_EVENT so frequent summary edits don't trigger the
// editor page's heavier full reload.
export function dispatchNovelOutlineDataChanged(detail: NovelOutlineDataChangedDetail) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<NovelOutlineDataChangedDetail>(NOVEL_OUTLINE_DATA_CHANGED_EVENT, { detail }))
}
