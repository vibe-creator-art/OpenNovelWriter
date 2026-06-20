import 'server-only'

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { SkillCategory } from '@/lib/skills'
import { parseSkillPresetAsset, type SkillPresetAssetV1 } from '@/lib/skill-preset'

export const BUILTIN_SKILL_PRESET_ASSET_DIR = join(process.cwd(), 'src', 'skill-presets', 'assets')

export interface BuiltinSkillPresetSummary {
    presetId: string
    name: string
    description: string | null
    revision: number
    exportedAt: string
    skillCount: number
    skillCategories: SkillCategory[]
    entrySkillName: string
    entrySkillCategory: SkillCategory
}

export interface BuiltinSkillPresetRegistryEntry {
    assetPath: string
    assetFilePath: string
    preset: SkillPresetAssetV1
    summary: BuiltinSkillPresetSummary
}

function cloneJsonValue<T>(value: T): T {
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value)) as T
}

function toSortedUniqueList<T extends string>(values: T[]): T[] {
    return [...new Set(values)].sort()
}

function toRelativeAssetPath(assetFilePath: string) {
    return relative(process.cwd(), assetFilePath).split('\\').join('/')
}

function createBuiltinSkillPresetSummary(preset: SkillPresetAssetV1): BuiltinSkillPresetSummary {
    const entrySkill = preset.bundle.skills[0]
    return {
        presetId: preset.metadata.presetId,
        name: preset.metadata.name,
        description: preset.metadata.description ?? null,
        revision: preset.metadata.revision,
        exportedAt: preset.metadata.exportedAt,
        skillCount: preset.bundle.skills.length,
        skillCategories: toSortedUniqueList(preset.bundle.skills.map((skill) => skill.category)),
        entrySkillName: entrySkill?.name ?? preset.metadata.name,
        entrySkillCategory: entrySkill?.category ?? 'scene_continuation',
    }
}

function listBuiltinSkillPresetAssetFilePaths() {
    try {
        return readdirSync(BUILTIN_SKILL_PRESET_ASSET_DIR, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => join(BUILTIN_SKILL_PRESET_ASSET_DIR, entry.name))
            .sort((left, right) => left.localeCompare(right))
    } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
        throw error
    }
}

function createBuiltinSkillPresetRegistryEntry(assetFilePath: string): BuiltinSkillPresetRegistryEntry {
    const rawText = readFileSync(assetFilePath, 'utf8')
    const parsedJson = JSON.parse(rawText) as unknown
    const parsed = parseSkillPresetAsset(parsedJson)
    if (!parsed.ok) {
        throw new Error(`Invalid builtin skill preset asset "${toRelativeAssetPath(assetFilePath)}": ${parsed.detail}`)
    }

    return {
        assetPath: toRelativeAssetPath(assetFilePath),
        assetFilePath,
        preset: parsed.preset,
        summary: createBuiltinSkillPresetSummary(parsed.preset),
    }
}

function createBuiltinSkillPresetRegistry(): BuiltinSkillPresetRegistryEntry[] {
    const registry = listBuiltinSkillPresetAssetFilePaths().map(createBuiltinSkillPresetRegistryEntry)
    const seen = new Set<string>()

    for (const entry of registry) {
        if (seen.has(entry.preset.metadata.presetId)) {
            throw new Error(`Duplicate builtin skill preset id "${entry.preset.metadata.presetId}".`)
        }
        seen.add(entry.preset.metadata.presetId)
    }

    return registry.sort((left, right) => left.summary.name.localeCompare(right.summary.name))
}

export function listBuiltinSkillPresetRegistryEntries(): BuiltinSkillPresetRegistryEntry[] {
    return createBuiltinSkillPresetRegistry().map((entry) => ({
        assetPath: entry.assetPath,
        assetFilePath: entry.assetFilePath,
        preset: cloneJsonValue(entry.preset),
        summary: cloneJsonValue(entry.summary),
    }))
}

export function listBuiltinSkillPresetSummaries(): BuiltinSkillPresetSummary[] {
    return listBuiltinSkillPresetRegistryEntries().map((entry) => entry.summary)
}

export function loadBuiltinSkillPresetRegistryEntry(presetId: string): BuiltinSkillPresetRegistryEntry | null {
    const entry = createBuiltinSkillPresetRegistry().find((item) => item.preset.metadata.presetId === presetId) ?? null
    if (!entry) return null

    return {
        assetPath: entry.assetPath,
        assetFilePath: entry.assetFilePath,
        preset: cloneJsonValue(entry.preset),
        summary: cloneJsonValue(entry.summary),
    }
}

export function loadBuiltinSkillPreset(presetId: string): SkillPresetAssetV1 | null {
    return loadBuiltinSkillPresetRegistryEntry(presetId)?.preset ?? null
}

export function requireBuiltinSkillPreset(presetId: string): SkillPresetAssetV1 {
    const preset = loadBuiltinSkillPreset(presetId)
    if (!preset) throw new Error(`Unknown builtin skill preset "${presetId}".`)
    return preset
}
