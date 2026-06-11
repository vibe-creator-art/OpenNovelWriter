'use client'

// Broadcast when a Codex session is deleted and its paired inline continuation panel must be
// removed from the live editor (the server already stripped the marker from the stored scene
// HTML; this covers the case where that scene is currently open so its TipTap node goes away
// before the next autosave can re-persist it).
const CONTINUATION_PANEL_REMOVED_EVENT = 'onw:continuation-panel-removed'

export function emitContinuationPanelRemoved(panelId: string) {
    if (typeof window === 'undefined' || !panelId) return
    window.dispatchEvent(new CustomEvent(CONTINUATION_PANEL_REMOVED_EVENT, { detail: { panelId } }))
}

export function subscribeContinuationPanelRemoved(handler: (panelId: string) => void) {
    if (typeof window === 'undefined') return () => {}
    const listener = (event: Event) => {
        const panelId = (event as CustomEvent<{ panelId?: string }>).detail?.panelId
        if (typeof panelId === 'string' && panelId) handler(panelId)
    }
    window.addEventListener(CONTINUATION_PANEL_REMOVED_EVENT, listener)
    return () => window.removeEventListener(CONTINUATION_PANEL_REMOVED_EVENT, listener)
}
