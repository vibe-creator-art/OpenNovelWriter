export const SKILL_CATEGORIES = [
    'scene_continuation',
    'scene_action',
    'ai_chat',
] as const

export type SkillCategory = (typeof SKILL_CATEGORIES)[number]

export const RESERVED_SKILL_SLASH_COMMANDS = ['plan', 'compact', 'fast'] as const

export function isSkillCategory(value: unknown): value is SkillCategory {
    return typeof value === 'string' && (SKILL_CATEGORIES as readonly string[]).includes(value)
}

export function normalizeSkillCategory(value: unknown): SkillCategory | null {
    return isSkillCategory(value) ? value : null
}

export function isReservedSkillSlashCommand(name: string) {
    return (RESERVED_SKILL_SLASH_COMMANDS as readonly string[]).includes(name.trim().toLowerCase())
}
