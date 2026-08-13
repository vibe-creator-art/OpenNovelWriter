import 'server-only'

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { parseAgentPresetAsset, type AgentPresetAssetV1 } from '@/lib/agent-preset'

export const BUILTIN_AGENT_PRESET_ASSET_DIR = join(process.cwd(), 'src', 'agent-presets', 'assets')
const AGENT_FILE_NAME = 'AGENTS.md'

export interface BuiltinAgentPresetSummary {
    presetId: string
    name: string
    description: string | null
    revision: number
    exportedAt: string
}

export interface BuiltinAgentPresetSource {
    relativePath: string
    directoryPath: string
    content: string
}

export interface BuiltinAgentPresetRegistryEntry {
    assetPath: string
    assetDirectoryPath: string
    presetFilePath: string
    preset: AgentPresetAssetV1
    source: BuiltinAgentPresetSource
    summary: BuiltinAgentPresetSummary
}

function cloneJsonValue<T>(value: T): T {
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value)) as T
}

function toRelativeAssetPath(assetPath: string) {
    return relative(process.cwd(), assetPath).split('\\').join('/')
}

function listBuiltinAgentPresetDirectories() {
    try {
        return readdirSync(BUILTIN_AGENT_PRESET_ASSET_DIR, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry) => join(BUILTIN_AGENT_PRESET_ASSET_DIR, entry.name))
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

function loadAgentSource(assetDirectoryPath: string, relativePath: string): BuiltinAgentPresetSource {
    const directoryPath = resolve(assetDirectoryPath, ...relativePath.split('/'))
    const relativeToAsset = relative(assetDirectoryPath, directoryPath)
    if (!relativeToAsset || relativeToAsset.startsWith('..')) {
        throw new Error(`Invalid agent directory path "${relativePath}".`)
    }
    if (!lstatSync(directoryPath).isDirectory() || lstatSync(directoryPath).isSymbolicLink()) {
        throw new Error(`Agent source "${relativePath}" must be a real directory.`)
    }

    const content = readFileSync(join(directoryPath, AGENT_FILE_NAME), 'utf8')
    if (!content.trim()) {
        throw new Error(`Agent source "${relativePath}" is missing AGENTS.md content.`)
    }

    return {
        relativePath,
        directoryPath,
        content,
    }
}

function createBuiltinAgentPresetRegistryEntry(assetDirectoryPath: string): BuiltinAgentPresetRegistryEntry {
    const presetFilePath = join(assetDirectoryPath, 'preset.json')
    const parsed = parseAgentPresetAsset(JSON.parse(readFileSync(presetFilePath, 'utf8')) as unknown)
    if (!parsed.ok) {
        throw new Error(`Invalid builtin agent preset "${toRelativeAssetPath(presetFilePath)}": ${parsed.detail}`)
    }

    const source = loadAgentSource(assetDirectoryPath, parsed.preset.agent)
    const summary: BuiltinAgentPresetSummary = {
        presetId: parsed.preset.metadata.presetId,
        name: parsed.preset.metadata.name,
        description: parsed.preset.metadata.description ?? null,
        revision: parsed.preset.metadata.revision,
        exportedAt: parsed.preset.metadata.exportedAt,
    }
    return {
        assetPath: toRelativeAssetPath(assetDirectoryPath),
        assetDirectoryPath,
        presetFilePath,
        preset: parsed.preset,
        source,
        summary,
    }
}

function createBuiltinAgentPresetRegistry(): BuiltinAgentPresetRegistryEntry[] {
    const registry = listBuiltinAgentPresetDirectories().map(createBuiltinAgentPresetRegistryEntry)
    const seen = new Set<string>()
    for (const entry of registry) {
        if (seen.has(entry.preset.metadata.presetId)) {
            throw new Error(`Duplicate builtin agent preset id "${entry.preset.metadata.presetId}".`)
        }
        seen.add(entry.preset.metadata.presetId)
    }
    return registry.sort((left, right) => left.summary.name.localeCompare(right.summary.name))
}

function cloneEntry(entry: BuiltinAgentPresetRegistryEntry): BuiltinAgentPresetRegistryEntry {
    return {
        ...entry,
        preset: cloneJsonValue(entry.preset),
        source: cloneJsonValue(entry.source),
        summary: cloneJsonValue(entry.summary),
    }
}

export function listBuiltinAgentPresetRegistryEntries() {
    return createBuiltinAgentPresetRegistry().map(cloneEntry)
}

export function listBuiltinAgentPresetSummaries() {
    return listBuiltinAgentPresetRegistryEntries().map((entry) => entry.summary)
}

export function loadBuiltinAgentPresetRegistryEntry(presetId: string) {
    const entry = createBuiltinAgentPresetRegistry().find((item) => item.preset.metadata.presetId === presetId) ?? null
    return entry ? cloneEntry(entry) : null
}

export function requireBuiltinAgentPresetRegistryEntry(presetId: string) {
    const entry = loadBuiltinAgentPresetRegistryEntry(presetId)
    if (!entry) throw new Error(`Unknown builtin agent preset "${presetId}".`)
    return entry
}
