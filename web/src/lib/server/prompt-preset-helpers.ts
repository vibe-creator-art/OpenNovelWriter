import type { PrismaClient } from '@prisma/client'
import {
    PROMPT_PRESET_SCHEMA,
    PROMPT_PRESET_VERSION,
    type PromptPresetAssetV1,
} from '@/lib/prompt-preset'
import {
    extractIncludeNamesFromMessages,
    type PromptBundlePromptV1,
    type PromptBundleV1,
} from '@/lib/prompt-bundle'
import { normalizePromptAgentCallMode, normalizePromptCategory, type PromptCategory } from '@/lib/prompts'
import { normalizePromptInputs } from '@/lib/prompt-inputs'
import { normalizeIncomingMessages, toPromptDto } from '@/lib/server/prompt-helpers'
import { toPromptNameKey } from '@/lib/server/prompt-names'

type PromptRecord = Parameters<typeof toPromptDto>[0]
type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

function normalizeStringIdList(value: unknown) {
    if (value === undefined) return undefined
    if (!Array.isArray(value)) return null

    const seen = new Set<string>()
    const result: string[] = []
    for (const item of value) {
        if (typeof item !== 'string') continue
        const trimmed = item.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        result.push(trimmed)
    }
    return result
}

function normalizeNameKey(value: string) {
    return value.trim().toLowerCase()
}

function toPromptBundlePrompt(record: PromptRecord): PromptBundlePromptV1 | null {
    const category = normalizePromptCategory(record.category)
    if (!category) return null

    const dto = toPromptDto(record)
    return {
        name: dto.name.trim(),
        category,
        description: dto.description ?? null,
        messages: dto.messages ?? [],
        inputs: dto.inputs ?? [],
        isNsfw: dto.isNsfw === true,
        modelGroupIds: dto.modelGroupIds ?? [],
        modelSetIds: dto.modelSetIds ?? [],
        allowLlmCall: dto.allowLlmCall === true,
        allowAgentCall: dto.allowAgentCall === true,
        agentCallMode: dto.agentCallMode ?? 'generate_then_agent',
    }
}

function promptHasPrivateModelBindings(prompt: PromptBundlePromptV1) {
    return (prompt.modelGroupIds?.length ?? 0) > 0 || (prompt.modelSetIds?.length ?? 0) > 0
}

export function getPromptPresetIllegalBindingDetail(presetName: string, promptName: string) {
    return `Preset "${presetName}" cannot be published because prompt "${promptName}" still contains private model bindings.`
}

export function getPromptPresetCloneIllegalBindingDetail(presetName: string, promptName: string) {
    return `Preset "${presetName}" cannot be cloned because prompt "${promptName}" still contains private model bindings.`
}

export async function buildPromptPresetAssetFromOwnedPrompt(params: {
    prisma: Tx
    userId: string
    promptId: string
    presetId: string
    name: string
    description: string | null
    revision: number
}): Promise<{ ok: true; preset: PromptPresetAssetV1 } | { ok: false; status: number; detail: string }> {
    const promptRecords = await params.prisma.prompt.findMany({
        where: { ownerId: params.userId },
    })

    const entryRecord = promptRecords.find((record) => record.id === params.promptId) ?? null
    if (!entryRecord) return { ok: false, status: 404, detail: 'Prompt not found.' }

    const entryPrompt = toPromptBundlePrompt(entryRecord)
    if (!entryPrompt) return { ok: false, status: 400, detail: 'Prompt category is invalid.' }

    const componentPromptsByNameKey = new Map<string, PromptBundlePromptV1>()
    for (const record of promptRecords) {
        const prompt = toPromptBundlePrompt(record)
        if (!prompt || prompt.category !== 'component') continue
        const key = normalizeNameKey(prompt.name)
        if (!key || componentPromptsByNameKey.has(key)) continue
        componentPromptsByNameKey.set(key, prompt)
    }

    const dependencyPrompts: PromptBundlePromptV1[] = []
    const missing = new Set<string>()
    const queued = [entryPrompt]
    const visited = new Set<string>()

    while (queued.length > 0) {
        const current = queued.shift()
        if (!current) continue

        for (const includeName of extractIncludeNamesFromMessages(current.messages ?? [])) {
            const key = normalizeNameKey(includeName)
            if (!key || visited.has(key) || key === normalizeNameKey(entryPrompt.name)) continue

            const found = componentPromptsByNameKey.get(key) ?? null
            if (!found) {
                missing.add(includeName)
                continue
            }

            visited.add(key)
            dependencyPrompts.push(found)
            queued.push(found)
        }
    }

    if (missing.size > 0) {
        return {
            ok: false,
            status: 400,
            detail: `Prompt preset export failed because required components are missing: ${[...missing].join(', ')}.`,
        }
    }

    const promptsForBundle = [entryPrompt, ...dependencyPrompts]
    const illegalPrompt = promptsForBundle.find(promptHasPrivateModelBindings) ?? null
    if (illegalPrompt) {
        return {
            ok: false,
            status: 400,
            detail: getPromptPresetIllegalBindingDetail(params.name, illegalPrompt.name),
        }
    }

    const exportedAt = new Date().toISOString()
    const bundle: PromptBundleV1 = {
        schema: 'open-novel-writer/prompt-bundle',
        version: 1,
        exportedAt,
        entryName: entryPrompt.name,
        prompts: promptsForBundle,
    }

    return {
        ok: true,
        preset: {
            schema: PROMPT_PRESET_SCHEMA,
            version: PROMPT_PRESET_VERSION,
            metadata: {
                presetId: params.presetId,
                name: params.name,
                description: params.description,
                revision: params.revision,
                exportedAt,
            },
            bundle,
        },
    }
}

export async function importPromptBundleForOwner(params: {
    prisma: Tx
    userId: string
    bundle: PromptBundleV1
    overwriteExisting: boolean
}): Promise<
    | { ok: true; prompts: ReturnType<typeof toPromptDto>[] }
    | { ok: false; status: number; detail: string; code?: string; names?: string[] }
> {
    const imported: Array<{
        name: string
        category: PromptCategory
        description: string | null
        messages: unknown
        inputs: unknown
        isNsfw: boolean
        modelGroupIds: string[] | undefined
        modelSetIds: string[] | undefined
        allowLlmCall: boolean
        allowAgentCall: boolean
        agentCallMode: ReturnType<typeof normalizePromptAgentCallMode>
    }> = []

    for (const prompt of params.bundle.prompts) {
        const name = typeof prompt.name === 'string' ? prompt.name.trim() : ''
        const category = normalizePromptCategory(prompt.category)
        const modelGroupIds = normalizeStringIdList(prompt.modelGroupIds)
        const modelSetIds = normalizeStringIdList(prompt.modelSetIds)

        if (!name) return { ok: false, status: 400, detail: 'Name is required.' }
        if (!category) return { ok: false, status: 400, detail: 'Invalid category.' }
        if (modelGroupIds === null) return { ok: false, status: 400, detail: 'Invalid modelGroupIds.' }
        if (modelSetIds === null) return { ok: false, status: 400, detail: 'Invalid modelSetIds.' }
        if ((modelGroupIds?.length ?? 0) > 0 || (modelSetIds?.length ?? 0) > 0) {
            return {
                ok: false,
                status: 400,
                detail: getPromptPresetCloneIllegalBindingDetail(params.bundle.entryName, name),
            }
        }

        imported.push({
            name,
            category,
            description: prompt.description ?? null,
            messages: prompt.messages,
            inputs: prompt.inputs ?? [],
            isNsfw: prompt.isNsfw === true,
            modelGroupIds,
            modelSetIds,
            allowLlmCall: category === 'component' ? false : prompt.allowLlmCall === true,
            allowAgentCall: category === 'component' ? false : prompt.allowAgentCall === true,
            agentCallMode: normalizePromptAgentCallMode(prompt.agentCallMode),
        })
    }

    const existingRecords = await params.prisma.prompt.findMany({
        where: { ownerId: params.userId },
    })
    const existingKeys = new Set(existingRecords.map((record) => toPromptNameKey(record.name)).filter(Boolean))
    const existingByNameKey = new Map(existingRecords.map((record) => [toPromptNameKey(record.name), record]))
    const incomingKeys = new Set<string>()
    const duplicateIncomingNames: string[] = []
    const conflictingNames: string[] = []

    for (const prompt of imported) {
        const key = toPromptNameKey(prompt.name)
        if (!key) continue
        if (incomingKeys.has(key)) duplicateIncomingNames.push(prompt.name)
        incomingKeys.add(key)
        if (existingKeys.has(key)) conflictingNames.push(prompt.name)
    }

    if (duplicateIncomingNames.length > 0) {
        return {
            ok: false,
            status: 400,
            detail: 'Duplicate prompt names in preset.',
            code: 'PROMPT_PRESET_DUPLICATE_NAMES',
            names: [...new Set(duplicateIncomingNames.map((n) => n.trim()).filter(Boolean))],
        }
    }

    if (conflictingNames.length > 0 && !params.overwriteExisting) {
        const unique = [...new Set(conflictingNames.map((n) => n.trim()).filter(Boolean))]
        const list = unique.slice(0, 8).join(', ')
        const suffix = unique.length > 8 ? ` (+${unique.length - 8} more)` : ''
        return {
            ok: false,
            status: 409,
            detail: `Prompt name already exists: ${list}${suffix}`,
            code: 'PROMPT_NAME_ALREADY_EXISTS',
            names: unique,
        }
    }

    const prepared: Array<{
        name: string
        category: PromptCategory
        description: string | null
        messagesJson: string
        inputsJson: string
        isNsfw: boolean
        modelGroupIdsJson: string
        modelSetIdsJson: string
        allowLlmCall: boolean
        allowAgentCall: boolean
        agentCallMode: ReturnType<typeof normalizePromptAgentCallMode>
    }> = []

    for (const prompt of imported) {
        const normalized = normalizeIncomingMessages({
            category: prompt.category,
            messages: prompt.messages,
        })
        if (!normalized.ok) return { ok: false, status: 400, detail: normalized.detail }

        const inputs = normalizePromptInputs(prompt.inputs)
        prepared.push({
            name: prompt.name,
            category: prompt.category,
            description: prompt.description,
            messagesJson: JSON.stringify(normalized.messages),
            inputsJson: JSON.stringify(inputs),
            isNsfw: prompt.isNsfw,
            modelGroupIdsJson: JSON.stringify(prompt.modelGroupIds ?? []),
            modelSetIdsJson: JSON.stringify(prompt.modelSetIds ?? []),
            allowLlmCall: prompt.allowLlmCall,
            allowAgentCall: prompt.allowAgentCall,
            agentCallMode: prompt.agentCallMode,
        })
    }

    const records = []
    for (const prompt of prepared) {
        const existing = existingByNameKey.get(toPromptNameKey(prompt.name)) ?? null
        const record = existing && params.overwriteExisting
            ? await params.prisma.prompt.update({
                where: { id: existing.id },
                data: {
                    name: prompt.name,
                    category: prompt.category,
                    description: prompt.description,
                    messagesJson: prompt.messagesJson,
                    inputsJson: prompt.inputsJson,
                    modelGroupIdsJson: prompt.modelGroupIdsJson,
                    modelSetIdsJson: prompt.modelSetIdsJson,
                    allowLlmCall: prompt.allowLlmCall,
                    allowAgentCall: prompt.allowAgentCall,
                    agentCallMode: prompt.agentCallMode,
                    isNsfw: prompt.isNsfw,
                },
            })
            : await params.prisma.prompt.create({
                data: {
                    name: prompt.name,
                    category: prompt.category,
                    description: prompt.description,
                    messagesJson: prompt.messagesJson,
                    inputsJson: prompt.inputsJson,
                    modelGroupIdsJson: prompt.modelGroupIdsJson,
                    modelSetIdsJson: prompt.modelSetIdsJson,
                    allowLlmCall: prompt.allowLlmCall,
                    allowAgentCall: prompt.allowAgentCall,
                    agentCallMode: prompt.agentCallMode,
                    isNsfw: prompt.isNsfw,
                    ownerId: params.userId,
                },
            })
        records.push(record)
    }

    return { ok: true, prompts: records.map(toPromptDto) }
}
