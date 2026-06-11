export const PROMPTS_CHANGED_EVENT = 'onw:prompts-changed'

export function dispatchPromptsChangedEvent() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(PROMPTS_CHANGED_EVENT))
}
