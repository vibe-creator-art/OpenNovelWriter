import 'server-only'

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import type { SkillCategory } from '@/lib/skills'
import { parseSkillPresetAsset, type SkillPresetAssetV1 } from '@/lib/skill-preset'
import { parseSkillContent, parseSkillOnwMetadataText } from '@/lib/server/skill-storage'

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

export interface BuiltinSkillPresetSource {
    relativePath: string
    directoryPath: string
    name: string
    description: string | null
    category: SkillCategory
    prompt: string | null
}

export interface BuiltinSkillPresetRegistryEntry {
    assetPath: string
    assetDirectoryPath: string
    presetFilePath: string
    preset: SkillPresetAssetV1
    skills: BuiltinSkillPresetSource[]
    summary: BuiltinSkillPresetSummary
}

function cloneJsonValue<T>(value: T): T {
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value)) as T
}

function toSortedUniqueList<T extends string>(values: T[]): T[] {
    return [...new Set(values)].sort()
}

function toRelativeAssetPath(assetPath: string) {
    return relative(process.cwd(), assetPath).split('\\').join('/')
}

function listBuiltinSkillPresetDirectories() {
    try {
        return readdirSync(BUILTIN_SKILL_PRESET_ASSET_DIR, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(BUILTIN_SKILL_PRESET_ASSET_DIR, entry.name))
            .filter((directory) => {
                try {
                    return lstatSync(join(directory, 'preset.json')).isFile()
                } catch {
                    return false
                }
            })
            .sort((left, right) => left.localeCompare(right))
    } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
        throw error
    }
}

function loadSkillSource(assetDirectoryPath: string, relativePath: string): BuiltinSkillPresetSource {
    const directoryPath = resolve(assetDirectoryPath, ...relativePath.split('/'))
    const relativeToAsset = relative(assetDirectoryPath, directoryPath)
    if (!relativeToAsset || relativeToAsset.startsWith('..')) {
        throw new Error(`Invalid skill directory path "${relativePath}".`)
    }
    if (!lstatSync(directoryPath).isDirectory() || lstatSync(directoryPath).isSymbolicLink()) {
        throw new Error(`Skill source "${relativePath}" must be a real directory.`)
    }

    const skill = parseSkillContent(readFileSync(join(directoryPath, 'SKILL.md'), 'utf8'))
    const metadata = parseSkillOnwMetadataText(readFileSync(join(directoryPath, 'onw.json'), 'utf8'))
    return {
        relativePath,
        directoryPath,
        name: skill.name,
        description: skill.description,
        category: metadata.category,
        prompt: metadata.prompt,
    }
}

function createBuiltinSkillPresetRegistryEntry(assetDirectoryPath: string): BuiltinSkillPresetRegistryEntry {
    const presetFilePath = join(assetDirectoryPath, 'preset.json')
    const parsed = parseSkillPresetAsset(JSON.parse(readFileSync(presetFilePath, 'utf8')) as unknown)
    if (!parsed.ok) {
        throw new Error(`Invalid builtin skill preset "${toRelativeAssetPath(presetFilePath)}": ${parsed.detail}`)
    }

    const skills = parsed.preset.skills.map((relativePath) => loadSkillSource(assetDirectoryPath, relativePath))
    const entrySkill = skills.find((skill) => skill.relativePath === parsed.preset.entrySkill) ?? skills[0]
    const summary: BuiltinSkillPresetSummary = {
        presetId: parsed.preset.metadata.presetId,
        name: parsed.preset.metadata.name,
        description: parsed.preset.metadata.description ?? null,
        revision: parsed.preset.metadata.revision,
        exportedAt: parsed.preset.metadata.exportedAt,
        skillCount: skills.length,
        skillCategories: toSortedUniqueList(skills.map((skill) => skill.category)),
        entrySkillName: entrySkill?.name ?? parsed.preset.metadata.name,
        entrySkillCategory: entrySkill?.category ?? 'scene_continuation',
    }
    return {
        assetPath: toRelativeAssetPath(assetDirectoryPath),
        assetDirectoryPath,
        presetFilePath,
        preset: parsed.preset,
        skills,
        summary,
    }
}

function createBuiltinSkillPresetRegistry(): BuiltinSkillPresetRegistryEntry[] {
    const registry = listBuiltinSkillPresetDirectories().map(createBuiltinSkillPresetRegistryEntry)
    const seen = new Set<string>()
    for (const entry of registry) {
        if (seen.has(entry.preset.metadata.presetId)) {
            throw new Error(`Duplicate builtin skill preset id "${entry.preset.metadata.presetId}".`)
        }
        seen.add(entry.preset.metadata.presetId)
    }
    return registry.sort((left, right) => left.summary.name.localeCompare(right.summary.name))
}

function cloneEntry(entry: BuiltinSkillPresetRegistryEntry): BuiltinSkillPresetRegistryEntry {
    return {
        ...entry,
        preset: cloneJsonValue(entry.preset),
        skills: cloneJsonValue(entry.skills),
        summary: cloneJsonValue(entry.summary),
    }
}

export function listBuiltinSkillPresetRegistryEntries() {
    return createBuiltinSkillPresetRegistry().map(cloneEntry)
}

export function listBuiltinSkillPresetSummaries() {
    return listBuiltinSkillPresetRegistryEntries().map((entry) => entry.summary)
}

export function loadBuiltinSkillPresetRegistryEntry(presetId: string) {
    const entry = createBuiltinSkillPresetRegistry().find((item) => item.preset.metadata.presetId === presetId) ?? null
    return entry ? cloneEntry(entry) : null
}

export function requireBuiltinSkillPresetRegistryEntry(presetId: string) {
    const entry = loadBuiltinSkillPresetRegistryEntry(presetId)
    if (!entry) throw new Error(`Unknown builtin skill preset "${presetId}".`)
    return entry
}
