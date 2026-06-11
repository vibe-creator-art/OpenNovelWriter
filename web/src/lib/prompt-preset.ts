import { parsePromptBundle, type PromptBundleV1 } from '@/lib/prompt-bundle'

export const PROMPT_PRESET_SCHEMA = 'open-novel-writer/prompt-preset' as const
export const PROMPT_PRESET_VERSION = 1 as const

const PROMPT_PRESET_KEY_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

export type PromptPresetKey = string

export interface PromptPresetMetadataV1 {
    presetId: PromptPresetKey
    name: string
    description: string | null
    revision: number
    exportedAt: string
}

export interface PromptPresetAssetV1 {
    schema: typeof PROMPT_PRESET_SCHEMA
    version: typeof PROMPT_PRESET_VERSION
    metadata: PromptPresetMetadataV1
    bundle: PromptBundleV1
}

type PromptPresetParseResult =
    | { ok: true; preset: PromptPresetAssetV1 }
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

function normalizePromptPresetKey(value: unknown): PromptPresetKey | null {
    const trimmed = asTrimmedString(value)?.toLowerCase() ?? null
    if (!trimmed) return null
    return PROMPT_PRESET_KEY_RE.test(trimmed) ? trimmed : null
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

function normalizePromptPresetMetadata(value: unknown): { ok: true; metadata: PromptPresetMetadataV1 } | { ok: false; detail: string } {
    const obj = asRecord(value)
    if (!obj) return { ok: false, detail: 'Preset metadata is required.' }

    const presetId = normalizePromptPresetKey(obj.presetId)
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

export function toPromptPresetKey(value: string): PromptPresetKey | null {
    return normalizePromptPresetKey(value)
}

export function createPromptPresetKey(value: string): PromptPresetKey {
    const trimmed = value.trim()
    const seed = trimmed || 'prompt-preset'
    const hash = hashStringToBase36(seed)
    const asciiSlug = trimmed
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-')

    if (asciiSlug && !/[^\x00-\x7F]/.test(trimmed)) return asciiSlug
    if (asciiSlug) return `${asciiSlug}-${hash}`
    return `preset-${hash}`
}

export function getNextPromptPresetRevision(revision: number) {
    return Math.round((revision + 0.1) * 10) / 10
}

export function serializePromptPresetJson(preset: PromptPresetAssetV1) {
    return JSON.stringify(preset, null, 2)
}

export function parsePromptPresetAsset(value: unknown): PromptPresetParseResult {
    const obj = asRecord(value)
    if (!obj) return { ok: false, detail: 'Invalid prompt preset JSON.' }
    if (obj.schema !== PROMPT_PRESET_SCHEMA) return { ok: false, detail: 'Unsupported prompt preset schema.' }
    if (obj.version !== PROMPT_PRESET_VERSION) return { ok: false, detail: 'Unsupported prompt preset version.' }

    const metadata = normalizePromptPresetMetadata(obj.metadata)
    if (!metadata.ok) return metadata

    const bundle = parsePromptBundle(obj.bundle)
    if (!bundle.ok) return { ok: false, detail: bundle.detail }

    return {
        ok: true,
        preset: {
            schema: PROMPT_PRESET_SCHEMA,
            version: PROMPT_PRESET_VERSION,
            metadata: metadata.metadata,
            bundle: bundle.bundle,
        },
    }
}

export function parsePromptPresetAssetFromText(text: string): PromptPresetParseResult {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, detail: 'Prompt preset JSON is empty.' }
    return parsePromptPresetAsset(safeJsonParse(trimmed))
}
