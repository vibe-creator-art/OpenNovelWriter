// Lightweight cross-component signal: fired whenever pending scene edits change
// (Codex applied new edits, or the author accepted/rejected one). The chat diff
// cards and the manuscript review UI both listen so they stay in sync without a store.
export const SCENE_EDITS_CHANGED_EVENT = 'onw:scene-edits-changed'

export function emitSceneEditsChanged(novelId?: string) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(SCENE_EDITS_CHANGED_EVENT, { detail: { novelId } }))
}
