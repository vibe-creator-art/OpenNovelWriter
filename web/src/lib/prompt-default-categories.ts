import { isPromptCategory, normalizePromptCategory } from '@/lib/prompts'

export const DEFAULT_PROMPT_SELECTION_CATEGORIES = [
    'scene_continuation',
    'scene_action',
    'text_replacement',
    'ai_chat',
] as const

export type DefaultPromptSelectionCategory = (typeof DEFAULT_PROMPT_SELECTION_CATEGORIES)[number]

export function isDefaultPromptSelectionCategory(value: unknown): value is DefaultPromptSelectionCategory {
    return typeof value === 'string' && (DEFAULT_PROMPT_SELECTION_CATEGORIES as readonly string[]).includes(value)
}

export function normalizeDefaultPromptSelectionCategory(value: unknown): DefaultPromptSelectionCategory | null {
    const normalized = normalizePromptCategory(value)
    if (!normalized || !isPromptCategory(normalized)) return null
    return isDefaultPromptSelectionCategory(normalized) ? normalized : null
}
