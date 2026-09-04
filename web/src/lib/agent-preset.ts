export const AGENT_PRESET_SCHEMA = 'open-novel-writer/agent-preset' as const
export const AGENT_PRESET_VERSION = 1 as const

const AGENT_PRESET_KEY_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

export type AgentPresetKey = string

export interface AgentPresetMetadataV1 {
    presetId: AgentPresetKey
    name: string
    description: string | null
    revision: number
    exportedAt: string
}

/**
 * A preset is a directory manifest. Agent content lives in the referenced folder beside
 * preset.json (typically `agent/AGENTS.md`) instead of being embedded as a Markdown string in JSON.
 */
export interface AgentPresetAssetV1 {
    schema: typeof AGENT_PRESET_SCHEMA
    version: typeof AGENT_PRESET_VERSION
    metadata: AgentPresetMetadataV1
    agent: string
}

type AgentPresetParseResult =
    | { ok: true; preset: AgentPresetAssetV1 }
    | { ok: false; detail: string }

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

function normalizeAgentPresetKey(value: unknown): AgentPresetKey | null {
    const trimmed = asTrimmedString(value)?.toLowerCase() ?? null
    return trimmed && AGENT_PRESET_KEY_RE.test(trimmed) ? trimmed : null
}

function normalizeRevision(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
    return Math.round(value * 10) / 10
}

function normalizeAgentDirectoryPath(value: unknown) {
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

export function createAgentPresetKey(value: string): AgentPresetKey {
    const trimmed = value.trim()
    const seed = trimmed || 'agent-preset'
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
    return `agent-${hash}`
}

export function getNextAgentPresetRevision(revision: number) {
    return Math.round((revision + 0.1) * 10) / 10
}

export function serializeAgentPresetJson(preset: AgentPresetAssetV1) {
    return JSON.stringify(preset, null, 2)
}

export function parseAgentPresetAsset(value: unknown): AgentPresetParseResult {
    const obj = asRecord(value)
    if (!obj) return { ok: false, detail: 'Invalid agent preset JSON.' }
    if (obj.schema !== AGENT_PRESET_SCHEMA) return { ok: false, detail: 'Unsupported agent preset schema.' }
    if (obj.version !== AGENT_PRESET_VERSION) return { ok: false, detail: 'Unsupported agent preset version.' }

    const rawMetadata = asRecord(obj.metadata)
    if (!rawMetadata) return { ok: false, detail: 'Preset metadata is required.' }
    const presetId = normalizeAgentPresetKey(rawMetadata.presetId)
    if (!presetId) return { ok: false, detail: 'metadata.presetId must be a stable lowercase key.' }
    const name = asTrimmedString(rawMetadata.name)
    if (!name) return { ok: false, detail: 'metadata.name is required.' }
    const revision = normalizeRevision(rawMetadata.revision)
    if (revision === null) return { ok: false, detail: 'metadata.revision must be a positive number.' }

    const agent = normalizeAgentDirectoryPath(obj.agent)
    if (!agent) return { ok: false, detail: 'agent must be a relative directory containing AGENTS.md.' }

    return {
        ok: true,
        preset: {
            schema: AGENT_PRESET_SCHEMA,
            version: AGENT_PRESET_VERSION,
            metadata: {
                presetId,
                name,
                description: typeof rawMetadata.description === 'string' ? rawMetadata.description : null,
                revision,
                exportedAt: typeof rawMetadata.exportedAt === 'string' && rawMetadata.exportedAt.trim()
                    ? rawMetadata.exportedAt
                    : new Date().toISOString(),
            },
            agent,
        },
    }
}
