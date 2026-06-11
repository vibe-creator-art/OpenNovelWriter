import 'server-only'

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { PromptCategory } from '@/lib/prompts'
import { parsePromptPresetAsset, type PromptPresetAssetV1 } from '@/lib/prompt-preset'

export const BUILTIN_PROMPT_PRESET_ASSET_DIR = join(process.cwd(), 'src', 'presets', 'assets')

export interface BuiltinPromptPresetSummary {
    presetId: string
    name: string
    description: string | null
    revision: number
    exportedAt: string
    promptCount: number
    promptCategories: PromptCategory[]
    entryPromptName: string
    entryPromptCategory: PromptCategory | string
}

export interface BuiltinPromptPresetRegistryEntry {
    assetPath: string
    assetFilePath: string
    preset: PromptPresetAssetV1
    summary: BuiltinPromptPresetSummary
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

function createBuiltinPromptPresetSummary(preset: PromptPresetAssetV1): BuiltinPromptPresetSummary {
    return {
        presetId: preset.metadata.presetId,
        name: preset.metadata.name,
        description: preset.metadata.description ?? null,
        revision: preset.metadata.revision,
        exportedAt: preset.metadata.exportedAt,
        promptCount: preset.bundle.prompts.length,
        promptCategories: toSortedUniqueList(preset.bundle.prompts.map((prompt) => prompt.category)),
        entryPromptName: preset.bundle.prompts[0]?.name ?? preset.metadata.name,
        entryPromptCategory: preset.bundle.prompts[0]?.category ?? 'component',
    }
}

function listBuiltinPromptPresetAssetFilePaths() {
    try {
        return readdirSync(BUILTIN_PROMPT_PRESET_ASSET_DIR, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => join(BUILTIN_PROMPT_PRESET_ASSET_DIR, entry.name))
            .sort((left, right) => left.localeCompare(right))
    } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
        throw error
    }
}

function createBuiltinPromptPresetRegistryEntry(assetFilePath: string): BuiltinPromptPresetRegistryEntry {
    const rawText = readFileSync(assetFilePath, 'utf8')
    const parsedJson = JSON.parse(rawText) as unknown
    const parsed = parsePromptPresetAsset(parsedJson)
    if (!parsed.ok) {
        throw new Error(`Invalid builtin prompt preset asset "${toRelativeAssetPath(assetFilePath)}": ${parsed.detail}`)
    }

    return {
        assetPath: toRelativeAssetPath(assetFilePath),
        assetFilePath,
        preset: parsed.preset,
        summary: createBuiltinPromptPresetSummary(parsed.preset),
    }
}

function createBuiltinPromptPresetRegistry(): BuiltinPromptPresetRegistryEntry[] {
    const registry = listBuiltinPromptPresetAssetFilePaths().map(createBuiltinPromptPresetRegistryEntry)
    const seen = new Set<string>()

    for (const entry of registry) {
        if (seen.has(entry.preset.metadata.presetId)) {
            throw new Error(`Duplicate builtin prompt preset id "${entry.preset.metadata.presetId}".`)
        }
        seen.add(entry.preset.metadata.presetId)
    }

    return registry.sort((left, right) => left.summary.name.localeCompare(right.summary.name))
}

export function listBuiltinPromptPresetRegistryEntries(): BuiltinPromptPresetRegistryEntry[] {
    return createBuiltinPromptPresetRegistry().map((entry) => ({
        assetPath: entry.assetPath,
        assetFilePath: entry.assetFilePath,
        preset: cloneJsonValue(entry.preset),
        summary: cloneJsonValue(entry.summary),
    }))
}

export function listBuiltinPromptPresetSummaries(): BuiltinPromptPresetSummary[] {
    return listBuiltinPromptPresetRegistryEntries().map((entry) => entry.summary)
}

export function loadBuiltinPromptPresetRegistryEntry(presetId: string): BuiltinPromptPresetRegistryEntry | null {
    const entry = createBuiltinPromptPresetRegistry().find((item) => item.preset.metadata.presetId === presetId) ?? null
    if (!entry) return null

    return {
        assetPath: entry.assetPath,
        assetFilePath: entry.assetFilePath,
        preset: cloneJsonValue(entry.preset),
        summary: cloneJsonValue(entry.summary),
    }
}

export function loadBuiltinPromptPreset(presetId: string): PromptPresetAssetV1 | null {
    return loadBuiltinPromptPresetRegistryEntry(presetId)?.preset ?? null
}

export function requireBuiltinPromptPreset(presetId: string): PromptPresetAssetV1 {
    const preset = loadBuiltinPromptPreset(presetId)
    if (!preset) throw new Error(`Unknown builtin prompt preset "${presetId}".`)
    return preset
}
