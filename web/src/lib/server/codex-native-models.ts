import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { isGptCodexModelId, normalizeCodexProviderModels, type CodexProviderModel } from '@/lib/codex-config'

export type CodexNativeModel = Record<string, unknown> & { slug: string }

const execFileAsync = promisify(execFile)

export async function readCodexNativeModels(codexHome?: string, modelIds: string[] = []): Promise<CodexNativeModel[]> {
    const homes = new Set([codexHome, path.join(os.homedir(), '.codex')].filter((home): home is string => !!home))
    const cached = new Map<string, CodexNativeModel>()
    for (const home of homes) {
        try {
            const models = parseNativeModels(await fs.readFile(path.join(home, 'models_cache.json'), 'utf8'))
            for (const model of models) {
                if (!cached.has(model.slug)) cached.set(model.slug, model)
            }
            const available = [...cached.values()]
            if (available.length > 0 && modelIds.every((id) => findCodexNativeModel(available, id))) return available
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
    }
    const { stdout } = await execFileAsync('codex', ['debug', 'models', '--bundled'], {
        maxBuffer: 16 * 1024 * 1024,
        shell: process.platform === 'win32',
    })
    return [...new Map([...parseNativeModels(stdout), ...cached.values()].map((model) => [model.slug, model])).values()]
}

function parseNativeModels(text: string): CodexNativeModel[] {
    const value = JSON.parse(text) as { models?: CodexNativeModel[] }
    if (!Array.isArray(value.models)) throw new Error('Codex returned an invalid model catalog.')
    return value.models
}

export function findCodexNativeModel(models: CodexNativeModel[], modelId: string) {
    const name = modelId.trim().split('/').at(-1)?.toLowerCase() ?? ''
    return models
        .filter((model) => {
            const slug = model.slug.toLowerCase()
            return name === slug || name.startsWith(`${slug}-`) || name.startsWith(`${slug}:`)
        })
        .sort((left, right) => right.slug.length - left.slug.length)[0]
}

export function resolveCodexProviderModels(models: CodexProviderModel[], nativeModels: CodexNativeModel[], baseUrl?: string | null) {
    const resolved = models.map((model) => {
        if (!isGptCodexModelId(model.id)) return model
        const native = findCodexNativeModel(nativeModels, model.id)
        if (!native) throw new Error(`The installed Codex model catalog does not include ${model.id}. Refresh or update Codex to use this model.`)
        return { ...nativeProviderModel(native), id: model.id }
    })
    const isOpenCode = /^https:\/\/opencode\.ai\/zen\/(?:go\/)?v1\/*$/.test(baseUrl?.trim() ?? '')
    if (isOpenCode || !models.some((model) => isGptCodexModelId(model.id))) return resolved
    const ids = new Set(resolved.map((model) => model.id.toLowerCase()))
    for (const native of nativeModels) {
        if (!isGptCodexModelId(native.slug) || native.visibility !== 'list' || ids.has(native.slug.toLowerCase())) continue
        resolved.push(nativeProviderModel(native))
    }
    return resolved
}

function nativeProviderModel(model: CodexNativeModel): CodexProviderModel {
    const [result] = normalizeCodexProviderModels([{
        id: model.slug,
        displayName: model.display_name,
        contextWindow: model.context_window,
        supportedReasoningEfforts: (model.supported_reasoning_levels as Array<{ effort: string }>).map((level) => level.effort),
        defaultReasoningEffort: model.default_reasoning_level,
        supportsParallelToolCalls: model.supports_parallel_tool_calls,
        inputModalities: model.input_modalities,
    }])
    if (!result) throw new Error(`Codex returned invalid capabilities for ${model.slug}.`)
    return result
}
