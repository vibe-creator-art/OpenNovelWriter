export const MODEL_GROUPS_CHANGED_EVENT = 'onw:model-groups-changed'

export function dispatchModelGroupsChangedEvent() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(MODEL_GROUPS_CHANGED_EVENT))
}
