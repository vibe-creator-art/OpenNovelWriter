export const PROMPT_CATEGORIES = [
    'default',
    'scene_continuation',
    'scene_action',
    'ai_chat',
    'component',
] as const

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]

export const PROMPT_MESSAGE_ROLES = ['system', 'user', 'assistant'] as const
export type PromptMessageRole = (typeof PROMPT_MESSAGE_ROLES)[number]

export const PROMPT_AGENT_CALL_MODES = ['generate_then_agent', 'agent_then_generate'] as const
export type PromptAgentCallMode = (typeof PROMPT_AGENT_CALL_MODES)[number]

export interface PromptMessage {
    id: string
    role: PromptMessageRole
    content: string
}

export function isPromptCategory(value: unknown): value is PromptCategory {
    return typeof value === 'string' && (PROMPT_CATEGORIES as readonly string[]).includes(value)
}

export function normalizePromptCategory(value: unknown): PromptCategory | null {
    return isPromptCategory(value) ? value : null
}

export function isPromptMessageRole(value: unknown): value is PromptMessageRole {
    return typeof value === 'string' && (PROMPT_MESSAGE_ROLES as readonly string[]).includes(value)
}

export function normalizePromptAgentCallMode(value: unknown): PromptAgentCallMode {
    return typeof value === 'string' && (PROMPT_AGENT_CALL_MODES as readonly string[]).includes(value)
        ? (value as PromptAgentCallMode)
        : 'generate_then_agent'
}
