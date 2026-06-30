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

function normalizeNameKey(value: string) {
    return value.trim().toLowerCase()
}

function toPromptBundlePrompt(record: PromptRecord): PromptBundlePromptV1 | null {
    const category = normalizePromptCategory(record.category)
    if (!category) return null

    const dto = toPromptDto(record)
    // Model bindings (modelGroupIds / modelSetIds) are user-local, not preset content: they are
    // never exported into a preset, so a published bundle carries no bindings.
    return {
        name: dto.name.trim(),
        category,
        description: dto.description ?? null,
        messages: dto.messages ?? [],
        inputs: dto.inputs ?? [],
        isNsfw: dto.isNsfw === true,
        allowLlmCall: dto.allowLlmCall === true,
        allowAgentCall: dto.allowAgentCall === true,
        agentCallMode: dto.agentCallMode ?? 'generate_then_agent',
    }
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
    sourcePresetId?: string | null
    sourcePresetRevision?: number | null
}): Promise<
    | { ok: true; prompts: ReturnType<typeof toPromptDto>[] }
    | { ok: false; status: number; detail: string; code?: string; names?: string[] }
> {
    // Model bindings are user-local and never travel in a preset: incoming bindings are ignored, a
    // newly created prompt starts unbound, and an upgrade leaves the existing prompt's bindings alone.
    const imported: Array<{
        name: string
        category: PromptCategory
        description: string | null
        messages: unknown
        inputs: unknown
        isNsfw: boolean
        allowLlmCall: boolean
        allowAgentCall: boolean
        agentCallMode: ReturnType<typeof normalizePromptAgentCallMode>
    }> = []

    for (const prompt of params.bundle.prompts) {
        const name = typeof prompt.name === 'string' ? prompt.name.trim() : ''
        const category = normalizePromptCategory(prompt.category)

        if (!name) return { ok: false, status: 400, detail: 'Name is required.' }
        if (!category) return { ok: false, status: 400, detail: 'Invalid category.' }

        imported.push({
            name,
            category,
            description: prompt.description ?? null,
            messages: prompt.messages,
            inputs: prompt.inputs ?? [],
            isNsfw: prompt.isNsfw === true,
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
            allowLlmCall: prompt.allowLlmCall,
            allowAgentCall: prompt.allowAgentCall,
            agentCallMode: prompt.agentCallMode,
        })
    }

    const records = []
    for (const prompt of prepared) {
        const existing = existingByNameKey.get(toPromptNameKey(prompt.name)) ?? null
        const record = existing && params.overwriteExisting
            // Upgrade: refresh preset content but never touch the user's model bindings.
            ? await params.prisma.prompt.update({
                where: { id: existing.id },
                data: {
                    name: prompt.name,
                    category: prompt.category,
                    description: prompt.description,
                    messagesJson: prompt.messagesJson,
                    inputsJson: prompt.inputsJson,
                    allowLlmCall: prompt.allowLlmCall,
                    allowAgentCall: prompt.allowAgentCall,
                    agentCallMode: prompt.agentCallMode,
                    isNsfw: prompt.isNsfw,
                    sourcePresetId: params.sourcePresetId ?? null,
                    sourcePresetRevision: params.sourcePresetRevision ?? null,
                },
            })
            // Create: starts unbound (modelGroupIdsJson / modelSetIdsJson fall back to their "[]" default).
            : await params.prisma.prompt.create({
                data: {
                    name: prompt.name,
                    category: prompt.category,
                    description: prompt.description,
                    messagesJson: prompt.messagesJson,
                    inputsJson: prompt.inputsJson,
                    allowLlmCall: prompt.allowLlmCall,
                    allowAgentCall: prompt.allowAgentCall,
                    agentCallMode: prompt.agentCallMode,
                    isNsfw: prompt.isNsfw,
                    sourcePresetId: params.sourcePresetId ?? null,
                    sourcePresetRevision: params.sourcePresetRevision ?? null,
                    ownerId: params.userId,
                },
            })
        records.push(record)
    }

    return { ok: true, prompts: records.map(toPromptDto) }
}
