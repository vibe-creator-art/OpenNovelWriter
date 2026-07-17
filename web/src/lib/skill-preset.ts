export const SKILL_PRESET_SCHEMA = 'open-novel-writer/skill-preset' as const
export const SKILL_PRESET_VERSION = 1 as const

const SKILL_PRESET_KEY_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

export type SkillPresetKey = string

export interface SkillPresetMetadataV1 {
    presetId: SkillPresetKey
    name: string
    description: string | null
    revision: number
    exportedAt: string
}

/**
 * A preset is a directory manifest. Skill contents live in the referenced folders beside
 * preset.json instead of being embedded as Markdown strings in JSON.
 */
export interface SkillPresetAssetV1 {
    schema: typeof SKILL_PRESET_SCHEMA
    version: typeof SKILL_PRESET_VERSION
    metadata: SkillPresetMetadataV1
    entrySkill: string
    skills: string[]
}

type SkillPresetParseResult =
    | { ok: true; preset: SkillPresetAssetV1 }
    | { ok: false; detail: string }

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

function safeJsonParse(value: string): unknown {
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

function normalizeSkillPresetKey(value: unknown): SkillPresetKey | null {
    const trimmed = asTrimmedString(value)?.toLowerCase() ?? null
    return trimmed && SKILL_PRESET_KEY_RE.test(trimmed) ? trimmed : null
}

function normalizeRevision(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
    return Math.round(value * 10) / 10
}

function normalizeSkillDirectoryPath(value: unknown) {
    const raw = asTrimmedString(value)?.replace(/\\/g, '/') ?? null
    if (!raw || raw.startsWith('/')) return null
    const segments = raw.split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) return null
    return segments.join('/')
}

function hashStringToBase36(value: string) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
}

export function toSkillPresetKey(value: string): SkillPresetKey | null {
    return normalizeSkillPresetKey(value)
}

export function createSkillPresetKey(value: string): SkillPresetKey {
    const trimmed = value.trim()
    const seed = trimmed || 'skill-preset'
    const hash = hashStringToBase36(seed)
    const asciiSlug = trimmed
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-')

    if (asciiSlug && !/[^\x00-\x7F]/.test(trimmed)) return asciiSlug
    if (asciiSlug) return `${asciiSlug}-${hash}`
    return `skill-${hash}`
}

export function getNextSkillPresetRevision(revision: number) {
    return Math.round((revision + 0.1) * 10) / 10
}

export function serializeSkillPresetJson(preset: SkillPresetAssetV1) {
    return JSON.stringify(preset, null, 2)
}

export function parseSkillPresetAsset(value: unknown): SkillPresetParseResult {
    const obj = asRecord(value)
    if (!obj) return { ok: false, detail: 'Invalid skill preset JSON.' }
    if (obj.schema !== SKILL_PRESET_SCHEMA) return { ok: false, detail: 'Unsupported skill preset schema.' }
    if (obj.version !== SKILL_PRESET_VERSION) return { ok: false, detail: 'Unsupported skill preset version.' }

    const rawMetadata = asRecord(obj.metadata)
    if (!rawMetadata) return { ok: false, detail: 'Preset metadata is required.' }
    const presetId = normalizeSkillPresetKey(rawMetadata.presetId)
    if (!presetId) return { ok: false, detail: 'metadata.presetId must be a stable lowercase key.' }
    const name = asTrimmedString(rawMetadata.name)
    if (!name) return { ok: false, detail: 'metadata.name is required.' }
    const revision = normalizeRevision(rawMetadata.revision)
    if (revision === null) return { ok: false, detail: 'metadata.revision must be a positive number.' }

    if (!Array.isArray(obj.skills) || obj.skills.length === 0) {
        return { ok: false, detail: 'skills must contain at least one skill directory.' }
    }
    const skills: string[] = []
    for (const value of obj.skills) {
        const directory = normalizeSkillDirectoryPath(value)
        if (!directory) return { ok: false, detail: 'skills contains an invalid relative directory.' }
        if (skills.includes(directory)) return { ok: false, detail: `Duplicate skill directory: ${directory}` }
        skills.push(directory)
    }
    const entrySkill = normalizeSkillDirectoryPath(obj.entrySkill)
    if (!entrySkill || !skills.includes(entrySkill)) {
        return { ok: false, detail: 'entrySkill must reference one of the skill directories.' }
    }

    return {
        ok: true,
        preset: {
            schema: SKILL_PRESET_SCHEMA,
            version: SKILL_PRESET_VERSION,
            metadata: {
                presetId,
                name,
                description: typeof rawMetadata.description === 'string' ? rawMetadata.description : null,
                revision,
                exportedAt: typeof rawMetadata.exportedAt === 'string' && rawMetadata.exportedAt.trim()
                    ? rawMetadata.exportedAt
                    : new Date().toISOString(),
            },
            entrySkill,
            skills,
        },
    }
}

export function parseSkillPresetAssetFromText(text: string): SkillPresetParseResult {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, detail: 'Skill preset JSON is empty.' }
    return parseSkillPresetAsset(safeJsonParse(trimmed))
}
