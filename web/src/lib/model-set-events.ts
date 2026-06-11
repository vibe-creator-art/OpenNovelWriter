export const MODEL_SETS_CHANGED_EVENT = 'onw:model-sets-changed'

export function dispatchModelSetsChangedEvent() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(MODEL_SETS_CHANGED_EVENT))
}
