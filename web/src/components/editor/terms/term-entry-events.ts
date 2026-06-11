export type TermEntryPanelTab = 'details' | 'experiences' | 'research' | 'relations' | 'mentions' | 'tracking' | 'gallery'

export type OpenTermEntryEventDetail = {
    novelId?: string
    entryId: string
    tab?: TermEntryPanelTab
}

export const OPEN_TERM_ENTRY_EVENT = 'onw:open-term-entry'

export function dispatchOpenTermEntry(detail: OpenTermEntryEventDetail) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<OpenTermEntryEventDetail>(OPEN_TERM_ENTRY_EVENT, { detail }))
}

