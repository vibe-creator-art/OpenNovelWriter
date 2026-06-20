import fs from 'fs/promises'
import path from 'path'

import { getOpenNovelWriterDataDir } from '@/lib/server/data-dir'
import { SKILL_CATEGORIES, normalizeSkillCategory, type SkillCategory } from '@/lib/skills'

type ParsedSkillDocument = {
    name: string
    description: string | null
    category: SkillCategory
    prompt: string | null
}

type SkillPresetOrigin = { presetId: string; revision: number }

export type SkillRecord = {
    id: string
    name: string
    description: string | null
    category: SkillCategory
    /**
     * Enabled state is NOT stored in SKILL.md frontmatter. A skill is "enabled" when it is synced
     * into CODEX_HOME/skills (so Codex can discover it); disabling removes that symlink. The choice
     * is persisted out-of-band in `.disabled-skills.json` at the user's skills root so it survives
     * re-syncs (the symlink alone can't distinguish "new skill" from "user-disabled").
     */
    enabled: boolean
    prompt: string | null
    /**
     * The official preset this skill was cloned from, recorded in SKILL.md frontmatter as `presetId`.
     * Cloned-from-preset skills are read-only unless preset authoring is enabled; re-cloning the skill
     * (via {@link cloneSkill}) clears this so the copy becomes editable. Tracked out-of-band in
     * `.preset-origins.json` (NOT in SKILL.md) so the document stays clean.
     */
    sourcePresetId: string | null
    /** Revision of the official preset this skill was cloned from. */
    sourcePresetRevision: number | null
    content: string
    createdAt: Date
    updatedAt: Date
}

const SKILL_FILE_NAME = 'SKILL.md'
const SKILL_DIRECTORY_NAMES = ['scripts', 'references', 'assets'] as const
const DISABLED_SKILLS_FILE_NAME = '.disabled-skills.json'
const PRESET_ORIGINS_FILE_NAME = '.preset-origins.json'

export class SkillNotFoundError extends Error {}
export class DuplicateSkillNameError extends Error {}

export function getSkillsRoot() {
    return path.join(getOpenNovelWriterDataDir(), 'skills')
}

export function getUserSkillsRoot(ownerId: string) {
    return path.join(getSkillsRoot(), ownerId)
}

export async function listSkills(ownerId: string) {
    const root = getUserSkillsRoot(ownerId)
    await fs.mkdir(root, { recursive: true })

    const [entries, disabledIds, origins] = await Promise.all([
        fs.readdir(root, { withFileTypes: true }),
        getDisabledSkillIds(ownerId),
        getPresetOrigins(ownerId),
    ])
    const skills = await Promise.all(
        entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
                try {
                    return await readSkillRecord(ownerId, entry.name, disabledIds, origins)
                } catch {
                    return null
                }
            })
    )

    const categoryOrder = new Map(SKILL_CATEGORIES.map((category, index) => [category, index]))
    return skills
        .filter((skill): skill is SkillRecord => skill !== null)
        .sort(
            (left, right) =>
                (categoryOrder.get(left.category) ?? 999) - (categoryOrder.get(right.category) ?? 999)
                || right.updatedAt.getTime() - left.updatedAt.getTime()
                || left.name.localeCompare(right.name)
        )
}

export async function readSkill(ownerId: string, skillId: string) {
    const [disabledIds, origins] = await Promise.all([getDisabledSkillIds(ownerId), getPresetOrigins(ownerId)])
    return readSkillRecord(ownerId, normalizeSkillId(skillId), disabledIds, origins)
}

async function readSkillRecord(
    ownerId: string,
    directoryName: string,
    disabledIds: Set<string>,
    origins: Map<string, SkillPresetOrigin>
) {
    const directory = getSkillDirectory(ownerId, directoryName)
    const filePath = path.join(directory, SKILL_FILE_NAME)

    const [content, stats] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        fs.stat(filePath),
    ])

    const parsed = parseSkillDocument(content)
    const origin = origins.get(directoryName) ?? null
    return {
        id: directoryName,
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        enabled: !disabledIds.has(directoryName),
        prompt: parsed.prompt,
        sourcePresetId: origin?.presetId ?? null,
        sourcePresetRevision: origin?.revision ?? null,
        content: normalizeDocumentContent(content),
        createdAt: stats.birthtime,
        updatedAt: stats.mtime,
    } satisfies SkillRecord
}

export async function createSkill(input: {
    ownerId: string
    name: string
    category: SkillCategory
}) {
    const root = getUserSkillsRoot(input.ownerId)
    await fs.mkdir(root, { recursive: true })

    const existingKeys = await loadSkillNameKeys(input.ownerId)
    const uniqueName = getNextAvailableNumberedSkillName(input.name, existingKeys)
    const directoryName = await getUniqueSkillDirectoryName(root, uniqueName)
    const directory = path.join(root, directoryName)
    await fs.mkdir(directory, { recursive: true })
    await Promise.all(SKILL_DIRECTORY_NAMES.map((name) => fs.mkdir(path.join(directory, name), { recursive: true })))

    const content = createDefaultSkillMarkdown({
        name: uniqueName,
        category: input.category,
    })
    await fs.writeFile(path.join(directory, SKILL_FILE_NAME), content, 'utf8')

    return readSkill(input.ownerId, directoryName)
}

/**
 * Parse and validate a raw SKILL.md string without touching disk. Used when importing skill
 * presets so the caller can detect name conflicts before writing anything.
 */
export function parseSkillContent(content: string): ParsedSkillDocument {
    return parseSkillDocument(normalizeDocumentContent(content))
}

/**
 * Create a new skill directory from a full SKILL.md body (used by preset cloning). Unlike
 * {@link createSkill}, the name comes from the document frontmatter and is written verbatim — name
 * conflicts are expected to be resolved by the caller; only the on-disk directory name is de-duped.
 */
export async function createSkillFromContent(input: { ownerId: string; content: string }) {
    const normalized = normalizeDocumentContent(input.content)
    const parsed = parseSkillDocument(normalized)

    const root = getUserSkillsRoot(input.ownerId)
    await fs.mkdir(root, { recursive: true })

    const directoryName = await getUniqueSkillDirectoryName(root, parsed.name)
    const directory = path.join(root, directoryName)
    await fs.mkdir(directory, { recursive: true })
    await Promise.all(SKILL_DIRECTORY_NAMES.map((name) => fs.mkdir(path.join(directory, name), { recursive: true })))
    await fs.writeFile(path.join(directory, SKILL_FILE_NAME), normalized, 'utf8')

    return readSkill(input.ownerId, directoryName)
}

/**
 * Record (or clear, with `origin === null`) which official preset a skill was cloned from. Stored in
 * `.preset-origins.json` at the user's skills root, keyed by skill id, so SKILL.md stays clean.
 */
export async function setSkillPresetOrigin(ownerId: string, skillId: string, origin: SkillPresetOrigin | null) {
    const directoryName = normalizeSkillId(skillId)
    const origins = await getPresetOrigins(ownerId)
    if (origin) origins.set(directoryName, origin)
    else if (!origins.delete(directoryName)) return
    await writePresetOrigins(ownerId, origins)
}

/**
 * Duplicate an owned skill into a fresh, editable copy: the preset-origin marker is dropped (the new
 * directory simply has no `.preset-origins.json` entry) and the name is auto-numbered to avoid
 * collisions. This is the "clone before editing" escape hatch for skills cloned from an official preset.
 */
export async function cloneSkill(input: { ownerId: string; skillId: string }) {
    const source = await readSkill(input.ownerId, input.skillId)
    const existingKeys = await loadSkillNameKeys(input.ownerId)
    const cloneName = getNextAvailableNumberedSkillName(source.name, existingKeys)

    const content = setSkillFrontmatterField(source.content, 'name', cloneName)
    return createSkillFromContent({ ownerId: input.ownerId, content })
}

export async function updateSkill(input: {
    ownerId: string
    skillId: string
    content: string
}) {
    const directoryName = normalizeSkillId(input.skillId)
    const directory = getSkillDirectory(input.ownerId, directoryName)
    const content = normalizeDocumentContent(input.content)
    const parsed = parseSkillDocument(content)
    await ensureSkillExists(directory)

    const existingKeys = await loadSkillNameKeys(input.ownerId, directoryName)
    const nextKey = toSkillNameKey(parsed.name)
    if (nextKey && existingKeys.has(nextKey)) {
        throw new DuplicateSkillNameError('Skill name already exists')
    }

    // The directory name is a stable id: renaming a skill only rewrites frontmatter, it never moves the
    // directory. This removes the autosave race where a debounced save targeted a just-renamed directory.
    await fs.writeFile(path.join(directory, SKILL_FILE_NAME), content, 'utf8')
    return readSkill(input.ownerId, directoryName)
}

export async function deleteSkill(ownerId: string, skillId: string) {
    const directoryName = normalizeSkillId(skillId)
    await fs.rm(getSkillDirectory(ownerId, directoryName), {
        recursive: true,
        force: true,
    })
    // Drop any lingering disabled-state entry for the removed skill.
    const disabled = await getDisabledSkillIds(ownerId)
    if (disabled.delete(directoryName)) {
        await writeDisabledSkillIds(ownerId, disabled)
    }
    // Drop any preset-origin entry for the removed skill.
    await setSkillPresetOrigin(ownerId, directoryName, null)
}

function getDisabledSkillsFilePath(ownerId: string) {
    return path.join(getUserSkillsRoot(ownerId), DISABLED_SKILLS_FILE_NAME)
}

async function getDisabledSkillIds(ownerId: string): Promise<Set<string>> {
    try {
        const raw = await fs.readFile(getDisabledSkillsFilePath(ownerId), 'utf8')
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return new Set()
        return new Set(parsed.filter((value): value is string => typeof value === 'string'))
    } catch {
        return new Set()
    }
}

async function writeDisabledSkillIds(ownerId: string, ids: Set<string>) {
    const root = getUserSkillsRoot(ownerId)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(getDisabledSkillsFilePath(ownerId), `${JSON.stringify([...ids], null, 2)}\n`, 'utf8')
}

function getPresetOriginsFilePath(ownerId: string) {
    return path.join(getUserSkillsRoot(ownerId), PRESET_ORIGINS_FILE_NAME)
}

async function getPresetOrigins(ownerId: string): Promise<Map<string, SkillPresetOrigin>> {
    try {
        const raw = await fs.readFile(getPresetOriginsFilePath(ownerId), 'utf8')
        const parsed = JSON.parse(raw) as unknown
        if (typeof parsed !== 'object' || parsed === null) return new Map()
        const result = new Map<string, SkillPresetOrigin>()
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value !== 'object' || value === null) continue
            const presetId = (value as { presetId?: unknown }).presetId
            const revision = (value as { revision?: unknown }).revision
            if (typeof presetId !== 'string' || !presetId.trim()) continue
            result.set(key, {
                presetId: presetId.trim(),
                revision: typeof revision === 'number' && Number.isFinite(revision) ? revision : 1,
            })
        }
        return result
    } catch {
        return new Map()
    }
}

async function writePresetOrigins(ownerId: string, origins: Map<string, SkillPresetOrigin>) {
    const root = getUserSkillsRoot(ownerId)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(getPresetOriginsFilePath(ownerId), `${JSON.stringify(Object.fromEntries(origins), null, 2)}\n`, 'utf8')
}

/**
 * Toggle a skill's enabled state. Enabled skills get synced into CODEX_HOME/skills; disabled ones
 * are recorded here and skipped by the sync (which then removes their symlink). The caller is
 * responsible for re-running the Codex skill sync afterwards.
 */
export async function setSkillEnabled(ownerId: string, skillId: string, enabled: boolean) {
    const directoryName = normalizeSkillId(skillId)
    await ensureSkillExists(getSkillDirectory(ownerId, directoryName))

    const disabled = await getDisabledSkillIds(ownerId)
    let changed = false
    if (enabled) {
        changed = disabled.delete(directoryName)
    } else if (!disabled.has(directoryName)) {
        disabled.add(directoryName)
        changed = true
    }
    if (changed) await writeDisabledSkillIds(ownerId, disabled)
    return readSkill(ownerId, directoryName)
}

export function toSkillDto(record: SkillRecord) {
    return {
        id: record.id,
        name: record.name,
        description: record.description,
        category: record.category,
        enabled: record.enabled,
        prompt: record.prompt,
        content: record.content,
        sourcePresetId: record.sourcePresetId,
        sourcePresetRevision: record.sourcePresetRevision,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    }
}

export function getSkillValidationErrorDetail(error: unknown) {
    if (error instanceof SkillNotFoundError) return 'Skill not found'
    if (error instanceof DuplicateSkillNameError) return error.message
    const message = error instanceof Error ? error.message.trim() : String(error).trim()
    return message || 'Internal server error'
}

function getSkillDirectory(ownerId: string, skillId: string) {
    return path.join(getUserSkillsRoot(ownerId), skillId)
}

function normalizeSkillId(skillId: string) {
    const trimmed = skillId.trim()
    if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
        throw new Error('Invalid skill id')
    }
    return trimmed
}

function normalizeDocumentContent(content: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

async function getUniqueSkillDirectoryName(root: string, name: string) {
    const base = sanitizeSkillDirectoryName(name) || 'skill'
    let candidate = base
    let counter = 1

    for (;;) {
        try {
            await fs.access(path.join(root, candidate))
            counter += 1
            candidate = `${base}-${counter}`
        } catch {
            return candidate
        }
    }
}

function sanitizeSkillDirectoryName(name: string) {
    return name
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
}

function escapeFrontmatterScalar(value: string) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Set (or, with `value === null`, remove) a top-level scalar field in a SKILL.md frontmatter block.
 * Only matches fields at column 0, so it never touches indented block-scalar continuation lines.
 */
function setSkillFrontmatterField(content: string, key: string, value: string | null): string {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return normalized

    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return normalized

    const frontmatter = normalized.slice(4, closingIndex)
    const body = normalized.slice(closingIndex + 5)
    const pattern = new RegExp(`^${key}\\s*:`)
    const lines = frontmatter.split('\n').filter((line) => !pattern.test(line))
    if (value !== null) {
        lines.push(`${key}: ${escapeFrontmatterScalar(value)}`)
    }

    return `---\n${lines.join('\n')}\n---\n${body}`
}

function createDefaultSkillMarkdown(input: { name: string; category: SkillCategory }) {
    return [
        '---',
        `name: ${escapeFrontmatterScalar(input.name)}`,
        'description: ""',
        `category: ${input.category}`,
        'prompt: ""',
        '---',
        '',
        '## Purpose',
        'Describe the task this skill is responsible for.',
        '',
        '## When to use',
        '- Explain the trigger scenarios for this skill.',
        '- Explain the expected inputs or context.',
        '',
        '## Instructions',
        '1. Describe the workflow step by step.',
        '2. Note any constraints, checks, or style requirements.',
        '',
        '## Output',
        '- Describe the expected result or response format.',
        '',
    ].join('\n')
}

function parseSkillDocument(content: string): ParsedSkillDocument {
    const { frontmatter } = splitFrontmatter(content)
    if (!frontmatter) {
        throw new Error('Skills must start with YAML frontmatter in SKILL.md.')
    }

    const fields = parseFrontmatterFields(frontmatter)
    const name = fields.name?.trim() ?? ''
    const description = fields.description?.trim() || null
    const category = normalizeSkillCategory(fields.category?.trim())
    const prompt = fields.prompt?.trim() || null

    if (!name) throw new Error('Skill frontmatter must include a non-empty `name`.')
    if (!category) throw new Error('Skill frontmatter must include a valid `category`.')

    return { name, description, category, prompt }
}

async function loadSkillNameKeys(ownerId: string, excludeId?: string) {
    const skills = await listSkills(ownerId)
    const keys = new Set<string>()
    for (const skill of skills) {
        if (excludeId && skill.id === excludeId) continue
        const key = toSkillNameKey(skill.name)
        if (key) keys.add(key)
    }
    return keys
}

function getNextAvailableNumberedSkillName(baseName: string, existingKeys: Set<string>) {
    const trimmed = baseName.trim()
    const base = trimmed || 'New skill'
    if (!existingKeys.has(toSkillNameKey(base))) return base

    for (let i = 1; i < 10_000; i += 1) {
        const candidate = `${base} ${i}`
        if (!existingKeys.has(toSkillNameKey(candidate))) return candidate
    }

    return `${base} ${Date.now()}`
}

function toSkillNameKey(name: string) {
    return name.trim().toLowerCase()
}

async function ensureSkillExists(directory: string) {
    try {
        await fs.access(path.join(directory, SKILL_FILE_NAME))
    } catch {
        throw new SkillNotFoundError('Skill not found')
    }
}

function splitFrontmatter(markdown: string) {
    const normalized = markdown.replace(/\r\n/g, '\n')
    if (!normalized.startsWith('---\n')) return { frontmatter: '', body: normalized }

    const closingIndex = normalized.indexOf('\n---\n', 4)
    if (closingIndex === -1) return { frontmatter: '', body: normalized }

    return {
        frontmatter: normalized.slice(4, closingIndex).trim(),
        body: normalized.slice(closingIndex + 5),
    }
}

function parseFrontmatterFields(frontmatter: string) {
    const result: Record<string, string> = {}
    const lines = frontmatter.split('\n')

    let blockKey: string | null = null
    let blockFolded = false
    let blockLines: string[] = []

    const flushBlock = () => {
        if (!blockKey) return
        result[blockKey] = blockFolded
            ? blockLines.map((line) => line.trim()).join(' ').replace(/\s+/g, ' ').trim()
            : blockLines.join('\n').trim()
        blockKey = null
        blockFolded = false
        blockLines = []
    }

    for (const rawLine of lines) {
        if (blockKey) {
            if (rawLine.trim() === '') {
                blockLines.push('')
                continue
            }
            if (/^\s/.test(rawLine)) {
                blockLines.push(rawLine.replace(/^\s+/, ''))
                continue
            }
            flushBlock()
        }

        const line = rawLine.trim()
        if (!line) continue

        const separatorIndex = line.indexOf(':')
        if (separatorIndex === -1) continue

        const key = line.slice(0, separatorIndex).trim()
        const rawValue = line.slice(separatorIndex + 1).trim()
        if (!key) continue

        if (rawValue === '|' || rawValue === '|-' || rawValue === '>' || rawValue === '>-') {
            blockKey = key
            blockFolded = rawValue.startsWith('>')
            blockLines = []
            continue
        }

        result[key] = stripScalarQuotes(rawValue)
    }

    flushBlock()
    return result
}

function stripScalarQuotes(value: string) {
    const trimmed = value.trim()
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1)
    }
    return trimmed
}
