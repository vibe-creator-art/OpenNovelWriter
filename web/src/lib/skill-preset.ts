import { normalizeSkillCategory, type SkillCategory } from '@/lib/skills'

export const SKILL_PRESET_SCHEMA = 'open-novel-writer/skill-preset' as const
export const SKILL_PRESET_VERSION = 1 as const
export const SKILL_BUNDLE_SCHEMA = 'open-novel-writer/skill-bundle' as const
export const SKILL_BUNDLE_VERSION = 1 as const

const SKILL_PRESET_KEY_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

export type SkillPresetKey = string

export interface SkillPresetMetadataV1 {
    presetId: SkillPresetKey
    name: string
    description: string | null
    revision: number
    exportedAt: string
}

export interface SkillBundleSkillV1 {
    name: string
    description: string | null
    category: SkillCategory
    prompt: string | null
    content: string
}

export interface SkillBundleV1 {
    schema: typeof SKILL_BUNDLE_SCHEMA
    version: typeof SKILL_BUNDLE_VERSION
    exportedAt: string
    entryName: string
    skills: SkillBundleSkillV1[]
}

export interface SkillPresetAssetV1 {
    schema: typeof SKILL_PRESET_SCHEMA
    version: typeof SKILL_PRESET_VERSION
    metadata: SkillPresetMetadataV1
    bundle: SkillBundleV1
}

type SkillPresetParseResult =
    | { ok: true; preset: SkillPresetAssetV1 }
    | { ok: false; detail: string }

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
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
    if (!trimmed) return null
    return SKILL_PRESET_KEY_RE.test(trimmed) ? trimmed : null
}

function hashStringToBase36(value: string) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
}

function normalizeRevision(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
    return Math.round(value * 10) / 10
}

function normalizeSkillPresetMetadata(value: unknown): { ok: true; metadata: SkillPresetMetadataV1 } | { ok: false; detail: string } {
    const obj = asRecord(value)
    if (!obj) return { ok: false, detail: 'Preset metadata is required.' }

    const presetId = normalizeSkillPresetKey(obj.presetId)
    if (!presetId) return { ok: false, detail: 'metadata.presetId must be a stable lowercase key.' }

    const name = asTrimmedString(obj.name)
    if (!name) return { ok: false, detail: 'metadata.name is required.' }

    const revision = normalizeRevision(obj.revision)
    if (revision === null) return { ok: false, detail: 'metadata.revision must be a positive number.' }

    return {
        ok: true,
        metadata: {
            presetId,
            name,
            description: typeof obj.description === 'string' ? obj.description : null,
            revision,
            exportedAt: typeof obj.exportedAt === 'string' && obj.exportedAt.trim() ? obj.exportedAt : new Date().toISOString(),
        },
    }
}

function normalizeSkillBundleSkill(value: unknown): { ok: true; skill: SkillBundleSkillV1 } | { ok: false; detail: string } {
    const obj = asRecord(value)
    if (!obj) return { ok: false, detail: 'Bundle skill must be an object.' }

    const name = asTrimmedString(obj.name)
    if (!name) return { ok: false, detail: 'Bundle skill name is required.' }

    const category = normalizeSkillCategory(typeof obj.category === 'string' ? obj.category.trim() : obj.category)
    if (!category) return { ok: false, detail: `Bundle skill "${name}" has an invalid category.` }

    const content = typeof obj.content === 'string' ? obj.content : ''
    if (!content.trim()) return { ok: false, detail: `Bundle skill "${name}" is missing SKILL.md content.` }

    return {
        ok: true,
        skill: {
            name,
            description: asTrimmedString(obj.description),
            category,
            prompt: asTrimmedString(obj.prompt),
            content,
        },
    }
}

function normalizeSkillBundle(value: unknown): { ok: true; bundle: SkillBundleV1 } | { ok: false; detail: string } {
    const obj = asRecord(value)
    if (!obj) return { ok: false, detail: 'Skill bundle is required.' }
    if (obj.schema !== SKILL_BUNDLE_SCHEMA) return { ok: false, detail: 'Unsupported skill bundle schema.' }
    if (obj.version !== SKILL_BUNDLE_VERSION) return { ok: false, detail: 'Unsupported skill bundle version.' }
    if (!Array.isArray(obj.skills) || obj.skills.length === 0) return { ok: false, detail: 'Skill bundle must contain at least one skill.' }

    const skills: SkillBundleSkillV1[] = []
    for (const rawSkill of obj.skills) {
        const parsed = normalizeSkillBundleSkill(rawSkill)
        if (!parsed.ok) return parsed
        skills.push(parsed.skill)
    }

    const entryName = asTrimmedString(obj.entryName) ?? skills[0].name

    return {
        ok: true,
        bundle: {
            schema: SKILL_BUNDLE_SCHEMA,
            version: SKILL_BUNDLE_VERSION,
            exportedAt: typeof obj.exportedAt === 'string' && obj.exportedAt.trim() ? obj.exportedAt : new Date().toISOString(),
            entryName,
            skills,
        },
    }
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

    const metadata = normalizeSkillPresetMetadata(obj.metadata)
    if (!metadata.ok) return metadata

    const bundle = normalizeSkillBundle(obj.bundle)
    if (!bundle.ok) return { ok: false, detail: bundle.detail }

    return {
        ok: true,
        preset: {
            schema: SKILL_PRESET_SCHEMA,
            version: SKILL_PRESET_VERSION,
            metadata: metadata.metadata,
            bundle: bundle.bundle,
        },
    }
}

export function parseSkillPresetAssetFromText(text: string): SkillPresetParseResult {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, detail: 'Skill preset JSON is empty.' }
    return parseSkillPresetAsset(safeJsonParse(trimmed))
}
