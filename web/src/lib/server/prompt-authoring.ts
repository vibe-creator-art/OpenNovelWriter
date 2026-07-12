import type { Prisma, PrismaClient } from '@prisma/client'

import { prisma } from '@/lib/db'
import { normalizePromptInputs, type PromptInputDefinition } from '@/lib/prompt-inputs'
import { extractIncludeNamesFromMessages, toPromptNameKey } from '@/lib/prompt-bundle'
import { analyzeChatPromptMessages } from '@/lib/prompt-template'
import {
    normalizePromptAgentCallMode,
    normalizePromptCategory,
    type PromptAgentCallMode,
    type PromptCategory,
    type PromptMessage,
} from '@/lib/prompts'
import { isPresetAuthoringEnabled } from '@/lib/preset-authoring'
import { recordRevisionHistory, safeParseRevisionHistoryJson } from '@/lib/revision-history'
import { listSkills } from '@/lib/server/skill-storage'
import {
    getPromptPrimaryMessageContent,
    normalizeIncomingMessages,
    normalizeStoredMessages,
    toPromptDto,
} from '@/lib/server/prompt-helpers'
import { listBuiltinPromptPresetRegistryEntries } from '@/presets'

type DbClient = PrismaClient | Prisma.TransactionClient
type PromptRecord = Prisma.PromptGetPayload<Record<string, never>>

const CHANGE_SET_SCHEMA = 'open-novel-writer/prompt-change-set'
const CHANGE_SET_VERSION = 1
const MAX_INCLUDE_DEPTH = 5
const WRITABLE_FIELDS = new Set([
    'name',
    'category',
    'description',
    'messages',
    'inputs',
    'isNsfw',
    'allowLlmCall',
    'allowAgentCall',
    'agentCallMode',
    'sortOrder',
])

type WritablePrompt = {
    name: string
    category: PromptCategory
    description: string | null
    messages: PromptMessage[]
    inputs: PromptInputDefinition[]
    isNsfw: boolean
    allowLlmCall: boolean
    allowAgentCall: boolean
    agentCallMode: PromptAgentCallMode
    sortOrder: number
}

type PlannedOperation =
    | { action: 'create'; tempId: string; prompt: WritablePrompt }
    | { action: 'update'; id: string; expectedUpdatedAt: string; set: Partial<WritablePrompt>; prompt: WritablePrompt }
    | { action: 'delete'; id: string; expectedUpdatedAt: string; name: string; category: string }

export type PromptChangePlan = {
    creates: Array<{ tempId: string; name: string; category: PromptCategory }>
    updates: Array<{ id: string; name: string; previousName: string; category: PromptCategory }>
    deletes: Array<{ id: string; name: string; category: string }>
    warnings: string[]
}

export type PromptChangeResult =
    | { ok: true; mode: 'validate'; plan: PromptChangePlan }
    | { ok: true; mode: 'apply'; plan: PromptChangePlan; prompts: ReturnType<typeof toPromptDto>[] }
    | { ok: false; status: number; detail: string; errors: string[]; warnings: string[] }

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function promptRecordToWritable(record: PromptRecord): WritablePrompt {
    const dto = toPromptDto(record)
    const category = normalizePromptCategory(dto.category)
    if (!category) throw new Error(`Prompt "${record.name}" has an invalid stored category.`)
    return {
        name: dto.name,
        category,
        description: dto.description ?? null,
        messages: dto.messages,
        inputs: dto.inputs,
        isNsfw: dto.isNsfw,
        allowLlmCall: dto.allowLlmCall,
        allowAgentCall: dto.allowAgentCall,
        agentCallMode: dto.agentCallMode,
        sortOrder: dto.sortOrder,
    }
}

function validateMessages(value: unknown, category: PromptCategory, label: string, errors: string[]) {
    const initialErrorCount = errors.length
    if (!Array.isArray(value)) {
        errors.push(`${label}.messages must be an array.`)
        return null
    }
    for (const [index, raw] of value.entries()) {
        const message = asRecord(raw)
        if (!message) {
            errors.push(`${label}.messages[${index}] must be an object.`)
            continue
        }
        if (!['system', 'user', 'assistant'].includes(String(message.role ?? ''))) {
            errors.push(`${label}.messages[${index}].role is invalid.`)
        }
        if (typeof message.content !== 'string') {
            errors.push(`${label}.messages[${index}].content must be a string.`)
        }
        if (message.id !== undefined && (typeof message.id !== 'string' || !message.id.trim())) {
            errors.push(`${label}.messages[${index}].id must be a non-empty string when provided.`)
        }
    }
    if (errors.length > initialErrorCount) return null

    const normalized = normalizeIncomingMessages({ category, messages: value })
    if (!normalized.ok) {
        errors.push(`${label}: ${normalized.detail}.`)
        return null
    }
    const ids = new Set<string>()
    for (const message of normalized.messages) {
        if (ids.has(message.id)) errors.push(`${label} has duplicate message id "${message.id}".`)
        ids.add(message.id)
    }
    return normalized.messages
}

function validateInputs(value: unknown, label: string, errors: string[]) {
    const initialErrorCount = errors.length
    if (!Array.isArray(value)) {
        errors.push(`${label}.inputs must be an array.`)
        return null
    }
    for (const [index, raw] of value.entries()) {
        const input = asRecord(raw)
        if (!input) {
            errors.push(`${label}.inputs[${index}] must be an object.`)
            continue
        }
        if (!['custom', 'content_selection', 'checkbox'].includes(String(input.type ?? ''))) {
            errors.push(`${label}.inputs[${index}].type is invalid.`)
        }
        if (typeof input.name !== 'string' || !input.name.trim()) {
            errors.push(`${label}.inputs[${index}].name is required.`)
        }
        if (input.id !== undefined && (typeof input.id !== 'string' || !input.id.trim())) {
            errors.push(`${label}.inputs[${index}].id must be a non-empty string when provided.`)
        }
    }
    if (errors.length > initialErrorCount) return null

    const normalized = normalizePromptInputs(value)
    if (normalized.length !== value.length) {
        errors.push(`${label}.inputs contains an unsupported input definition.`)
        return null
    }
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const input of normalized) {
        const nameKey = toPromptNameKey(input.name)
        if (ids.has(input.id)) errors.push(`${label} has duplicate input id "${input.id}".`)
        if (names.has(nameKey)) errors.push(`${label} has duplicate input name "${input.name}".`)
        ids.add(input.id)
        names.add(nameKey)

        if (input.type === 'custom') {
            const optionIds = new Set<string>()
            const optionLabels = new Set<string>()
            for (const option of input.custom.dropdown.options) {
                const optionLabel = option.label.trim()
                if (!option.id.trim()) errors.push(`${label} has a dropdown option without an id.`)
                if (!optionLabel) errors.push(`${label} has a dropdown option without a label.`)
                if (optionIds.has(option.id)) errors.push(`${label} has duplicate dropdown option id "${option.id}".`)
                if (optionLabels.has(toPromptNameKey(optionLabel))) {
                    errors.push(`${label} has duplicate dropdown option label "${optionLabel}".`)
                }
                optionIds.add(option.id)
                optionLabels.add(toPromptNameKey(optionLabel))
            }
        }
    }
    return normalized
}

function parseWritablePrompt(
    value: unknown,
    label: string,
    errors: string[],
    base?: WritablePrompt
): WritablePrompt | null {
    const object = asRecord(value)
    if (!object) {
        errors.push(`${label} must be an object.`)
        return null
    }
    for (const key of Object.keys(object)) {
        if (!WRITABLE_FIELDS.has(key)) errors.push(`${label}.${key} is not writable.`)
    }

    const name = object.name === undefined && base ? base.name : typeof object.name === 'string' ? object.name.trim() : ''
    const categoryRaw = object.category === undefined && base ? base.category : object.category
    const category = normalizePromptCategory(categoryRaw)
    if (!name) errors.push(`${label}.name is required.`)
    if (!category) errors.push(`${label}.category is invalid.`)
    if (!category) return null

    const messagesRaw = object.messages === undefined && base ? base.messages : object.messages
    const inputsRaw = object.inputs === undefined && base ? base.inputs : object.inputs ?? []
    const messages = validateMessages(messagesRaw, category, label, errors)
    const inputs = validateInputs(inputsRaw, label, errors)
    if (!messages || !inputs) return null

    const description = object.description === undefined && base
        ? base.description
        : object.description === null
            ? null
            : typeof object.description === 'string'
                ? object.description
                : null
    if (object.description !== undefined && object.description !== null && typeof object.description !== 'string') {
        errors.push(`${label}.description must be a string or null.`)
    }

    for (const key of ['isNsfw', 'allowLlmCall', 'allowAgentCall'] as const) {
        if (object[key] !== undefined && typeof object[key] !== 'boolean') {
            errors.push(`${label}.${key} must be a boolean.`)
        }
    }
    if (object.sortOrder !== undefined && (typeof object.sortOrder !== 'number' || !Number.isFinite(object.sortOrder))) {
        errors.push(`${label}.sortOrder must be a finite number.`)
    }

    const component = category === 'component'
    const writable: WritablePrompt = {
        name,
        category,
        description,
        messages,
        inputs,
        isNsfw: typeof object.isNsfw === 'boolean' ? object.isNsfw : base?.isNsfw ?? false,
        allowLlmCall: component ? false : typeof object.allowLlmCall === 'boolean' ? object.allowLlmCall : base?.allowLlmCall ?? false,
        allowAgentCall: component ? false : typeof object.allowAgentCall === 'boolean' ? object.allowAgentCall : base?.allowAgentCall ?? false,
        agentCallMode: component
            ? 'generate_then_agent'
            : object.agentCallMode !== undefined
                ? normalizePromptAgentCallMode(object.agentCallMode)
                : base?.agentCallMode ?? 'generate_then_agent',
        sortOrder: typeof object.sortOrder === 'number' ? object.sortOrder : base?.sortOrder ?? 0,
    }

    if (category === 'ai_chat' && !analyzeChatPromptMessages(messages).valid) {
        errors.push(`${label}: ai_chat must end with a user message containing exactly one chat.userInput placeholder.`)
    }
    if (
        object.agentCallMode !== undefined
        && !['generate_then_agent', 'agent_then_generate'].includes(String(object.agentCallMode))
    ) {
        errors.push(`${label}.agentCallMode is invalid.`)
    }
    return writable
}

async function prepareChangeSet(db: DbClient, ownerId: string, changeSet: unknown) {
    const errors: string[] = []
    const warnings: string[] = []
    const object = asRecord(changeSet)
    if (!object || object.schema !== CHANGE_SET_SCHEMA || object.version !== CHANGE_SET_VERSION) {
        return { ok: false as const, errors: [`Expected ${CHANGE_SET_SCHEMA} version ${CHANGE_SET_VERSION}.`], warnings }
    }
    if (!Array.isArray(object.operations) || object.operations.length === 0) {
        return { ok: false as const, errors: ['operations must be a non-empty array.'], warnings }
    }

    const records = await db.prompt.findMany({ where: { ownerId } })
    const recordsById = new Map(records.map((record) => [record.id, record]))
    const finalById = new Map(records.map((record) => [record.id, promptRecordToWritable(record)]))
    const operations: PlannedOperation[] = []
    const touchedIds = new Set<string>()
    const oldNamesAffected = new Set<string>()

    for (const [index, rawOperation] of object.operations.entries()) {
        const label = `operations[${index}]`
        const operation = asRecord(rawOperation)
        if (!operation) {
            errors.push(`${label} must be an object.`)
            continue
        }
        const action = operation.action
        if (action === 'create') {
            const prompt = parseWritablePrompt(operation.prompt, `${label}.prompt`, errors)
            if (!prompt) continue
            const tempId = `new:${index}`
            finalById.set(tempId, prompt)
            operations.push({ action, tempId, prompt })
            continue
        }
        if (action !== 'update' && action !== 'delete') {
            errors.push(`${label}.action must be create, update, or delete.`)
            continue
        }
        const id = typeof operation.id === 'string' ? operation.id.trim() : ''
        const expectedUpdatedAt = typeof operation.expectedUpdatedAt === 'string' ? operation.expectedUpdatedAt.trim() : ''
        const record = id ? recordsById.get(id) ?? null : null
        if (!id) errors.push(`${label}.id is required.`)
        if (!expectedUpdatedAt) errors.push(`${label}.expectedUpdatedAt is required.`)
        if (!record) {
            errors.push(`${label}: prompt was not found for this user.`)
            continue
        }
        if (record.updatedAt.toISOString() !== expectedUpdatedAt) {
            errors.push(`${label}: "${record.name}" changed since it was exported. Export the library again.`)
        }
        if (touchedIds.has(id)) errors.push(`${label}: prompt ${id} appears more than once in the change-set.`)
        touchedIds.add(id)

        if (action === 'delete') {
            finalById.delete(id)
            oldNamesAffected.add(toPromptNameKey(record.name))
            operations.push({ action, id, expectedUpdatedAt, name: record.name, category: record.category })
            continue
        }

        if (record.sourcePresetId && !isPresetAuthoringEnabled()) {
            errors.push(`${label}: "${record.name}" is from an official preset. Clone it before editing.`)
            continue
        }
        const set = asRecord(operation.set)
        if (!set || Object.keys(set).length === 0) {
            errors.push(`${label}.set must contain at least one writable field.`)
            continue
        }
        const base = promptRecordToWritable(record)
        if (set.category !== undefined && set.category !== base.category && set.messages === undefined) {
            errors.push(`${label}.set.messages is required when changing category.`)
        }
        const prompt = parseWritablePrompt(set, `${label}.set`, errors, base)
        if (!prompt) continue
        finalById.set(id, prompt)
        if (toPromptNameKey(prompt.name) !== toPromptNameKey(record.name)) {
            oldNamesAffected.add(toPromptNameKey(record.name))
        }
        operations.push({ action, id, expectedUpdatedAt, set: set as Partial<WritablePrompt>, prompt })
    }

    const nameOwners = new Map<string, string>()
    for (const [id, prompt] of finalById.entries()) {
        const key = toPromptNameKey(prompt.name)
        const previous = nameOwners.get(key)
        if (previous && (touchedIds.has(id) || touchedIds.has(previous) || id.startsWith('new:') || previous.startsWith('new:'))) {
            errors.push(`Prompt name "${prompt.name}" conflicts with another prompt.`)
        }
        if (!previous) nameOwners.set(key, id)
    }

    const componentsByName = new Map<string, WritablePrompt>()
    for (const prompt of finalById.values()) {
        if (prompt.category === 'component') componentsByName.set(toPromptNameKey(prompt.name), prompt)
    }

    const affectedIds = new Set(operations.flatMap((operation) => operation.action === 'create' ? [operation.tempId] : operation.action === 'update' ? [operation.id] : []))
    for (const [id, prompt] of finalById.entries()) {
        const includeNames = extractIncludeNamesFromMessages(prompt.messages)
        const referencesAffectedName = includeNames.some((name) => oldNamesAffected.has(toPromptNameKey(name)))
        if (!affectedIds.has(id) && !referencesAffectedName) continue
        for (const includeName of includeNames) {
            if (!componentsByName.has(toPromptNameKey(includeName))) {
                errors.push(`Prompt "${prompt.name}" includes missing component "${includeName}".`)
            }
        }
    }

    // A changed component can make an unchanged parent exceed the runtime depth limit. Expand the
    // impacted set upward through reverse includes, then validate each impacted root downward.
    let expandedAffected = true
    while (expandedAffected) {
        expandedAffected = false
        const affectedNames = new Set([...affectedIds].map((id) => finalById.get(id)?.name).filter((name): name is string => Boolean(name)).map(toPromptNameKey))
        for (const [id, prompt] of finalById.entries()) {
            if (affectedIds.has(id)) continue
            if (extractIncludeNamesFromMessages(prompt.messages).some((name) => affectedNames.has(toPromptNameKey(name)))) {
                affectedIds.add(id)
                expandedAffected = true
            }
        }
    }

    const visitIncludes = (prompt: WritablePrompt, includeDepth: number, stack: string[]) => {
        for (const includeName of extractIncludeNamesFromMessages(prompt.messages)) {
            const nameKey = toPromptNameKey(includeName)
            const component = componentsByName.get(nameKey)
            if (!component) continue
            if (stack.includes(nameKey)) {
                errors.push(`Component include cycle: ${[...stack.map((key) => componentsByName.get(key)?.name ?? key), component.name].join(' -> ')}.`)
                continue
            }
            if (includeDepth + 1 > MAX_INCLUDE_DEPTH) {
                errors.push(`Component include depth exceeds ${MAX_INCLUDE_DEPTH}: ${[...stack.map((key) => componentsByName.get(key)?.name ?? key), component.name].join(' -> ')}.`)
                continue
            }
            visitIncludes(component, includeDepth + 1, [...stack, nameKey])
        }
    }
    for (const id of affectedIds) {
        const prompt = finalById.get(id)
        if (prompt) visitIncludes(prompt, 0, [])
    }

    const skills = await listSkills(ownerId)
    for (const operation of operations) {
        if (operation.action === 'create') continue
        const record = recordsById.get(operation.id)
        if (!record) continue
        const nameChanged = operation.action === 'delete'
            || toPromptNameKey(operation.prompt.name) !== toPromptNameKey(record.name)
        if (!nameChanged) continue
        const boundSkills = skills.filter((skill) => skill.prompt && toPromptNameKey(skill.prompt) === toPromptNameKey(record.name))
        if (boundSkills.length > 0) {
            errors.push(`Prompt "${record.name}" is bound by user skill(s): ${boundSkills.map((skill) => skill.name).join(', ')}. Update those skills first.`)
        }
    }

    const deletedIds = operations.filter((operation): operation is Extract<PlannedOperation, { action: 'delete' }> => operation.action === 'delete').map((operation) => operation.id)
    if (deletedIds.length > 0) {
        const [defaults, chatCounts] = await Promise.all([
            db.promptDefault.findMany({ where: { ownerId, promptId: { in: deletedIds } } }),
            db.editorChatConversation.groupBy({
                by: ['promptId'],
                where: { ownerId, promptId: { in: deletedIds } },
                _count: { _all: true },
            }),
        ])
        for (const selection of defaults) {
            const promptName = recordsById.get(selection.promptId)?.name ?? selection.promptId
            warnings.push(`Deleting "${promptName}" will clear the ${selection.category} default selection.`)
        }
        for (const count of chatCounts) {
            if (!count.promptId) continue
            const promptName = recordsById.get(count.promptId)?.name ?? count.promptId
            warnings.push(`Deleting "${promptName}" leaves ${count._count._all} existing AI chat conversation(s) on their saved prompt snapshots; their promptId is not migrated.`)
        }
    }

    if (errors.length > 0) return { ok: false as const, errors: [...new Set(errors)], warnings }

    const plan: PromptChangePlan = {
        creates: operations
            .filter((operation): operation is Extract<PlannedOperation, { action: 'create' }> => operation.action === 'create')
            .map((operation) => ({ tempId: operation.tempId, name: operation.prompt.name, category: operation.prompt.category })),
        updates: operations
            .filter((operation): operation is Extract<PlannedOperation, { action: 'update' }> => operation.action === 'update')
            .map((operation) => ({
                id: operation.id,
                name: operation.prompt.name,
                previousName: recordsById.get(operation.id)?.name ?? operation.prompt.name,
                category: operation.prompt.category,
            })),
        deletes: operations
            .filter((operation): operation is Extract<PlannedOperation, { action: 'delete' }> => operation.action === 'delete')
            .map((operation) => ({ id: operation.id, name: operation.name, category: operation.category })),
        warnings,
    }
    return { ok: true as const, operations, plan, recordsById }
}

function writableToDbData(prompt: WritablePrompt) {
    return {
        name: prompt.name,
        category: prompt.category,
        description: prompt.description,
        messagesJson: JSON.stringify(prompt.messages),
        inputsJson: JSON.stringify(prompt.inputs),
        isNsfw: prompt.isNsfw,
        allowLlmCall: prompt.allowLlmCall,
        allowAgentCall: prompt.allowAgentCall,
        agentCallMode: prompt.agentCallMode,
        sortOrder: prompt.sortOrder,
    }
}

export async function processPromptChangeSet(params: {
    ownerId: string
    changeSet: unknown
    mode: 'validate' | 'apply'
}): Promise<PromptChangeResult> {
    if (params.mode === 'validate') {
        const prepared = await prepareChangeSet(prisma, params.ownerId, params.changeSet)
        if (!prepared.ok) {
            return { ok: false, status: 400, detail: prepared.errors[0], errors: prepared.errors, warnings: prepared.warnings }
        }
        return { ok: true, mode: 'validate', plan: prepared.plan }
    }

    try {
        return await prisma.$transaction(async (tx) => {
            const prepared = await prepareChangeSet(tx, params.ownerId, params.changeSet)
            if (!prepared.ok) {
                return { ok: false, status: 400, detail: prepared.errors[0], errors: prepared.errors, warnings: prepared.warnings }
            }

            const changed: PromptRecord[] = []
            for (const operation of prepared.operations) {
                if (operation.action === 'create') {
                    changed.push(await tx.prompt.create({
                        data: { ...writableToDbData(operation.prompt), ownerId: params.ownerId },
                    }))
                    continue
                }
                if (operation.action === 'delete') {
                    await tx.prompt.delete({ where: { id: operation.id } })
                    continue
                }

                const existing = prepared.recordsById.get(operation.id)
                if (!existing) throw new Error(`Prompt ${operation.id} disappeared during apply.`)
                const data: Prisma.PromptUpdateInput = writableToDbData(operation.prompt)
                const oldMessages = normalizeStoredMessages({
                    promptId: existing.id,
                    category: existing.category,
                    messagesJson: existing.messagesJson,
                })
                if (getPromptPrimaryMessageContent(oldMessages) !== getPromptPrimaryMessageContent(operation.prompt.messages)) {
                    const history = safeParseRevisionHistoryJson(existing.historyJson, { idPrefix: 'prompt' })
                    const next = recordRevisionHistory(history, getPromptPrimaryMessageContent(operation.prompt.messages), {
                        idPrefix: 'prompt',
                        normalize: (value) => value.trim(),
                    })
                    if (next.recorded) data.historyJson = JSON.stringify(next.history)
                }
                changed.push(await tx.prompt.update({ where: { id: operation.id }, data }))
            }
            return { ok: true, mode: 'apply', plan: prepared.plan, prompts: changed.map(toPromptDto) }
        })
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Failed to apply prompt changes.'
        return { ok: false, status: 500, detail, errors: [detail], warnings: [] }
    }
}

function toExportPrompt(record: PromptRecord) {
    const dto = toPromptDto(record)
    return {
        id: dto.id,
        name: dto.name,
        category: dto.category,
        description: dto.description,
        messages: dto.messages,
        inputs: dto.inputs,
        isNsfw: dto.isNsfw,
        allowLlmCall: dto.allowLlmCall,
        allowAgentCall: dto.allowAgentCall,
        agentCallMode: dto.agentCallMode,
        sortOrder: dto.sortOrder,
        sourcePresetId: dto.sourcePresetId,
        sourcePresetRevision: dto.sourcePresetRevision,
        createdAt: dto.createdAt.toISOString(),
        updatedAt: dto.updatedAt.toISOString(),
    }
}

export async function buildPromptLibraryExport(ownerId: string) {
    const [records, defaults, skills] = await Promise.all([
        prisma.prompt.findMany({ where: { ownerId }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { updatedAt: 'desc' }] }),
        prisma.promptDefault.findMany({ where: { ownerId } }),
        listSkills(ownerId),
    ])
    const prompts = records.map(toExportPrompt)
    const byName = new Map(prompts.map((prompt) => [toPromptNameKey(prompt.name), prompt]))
    const reverseIncludes = new Map<string, string[]>()
    for (const prompt of prompts) {
        for (const includeName of extractIncludeNamesFromMessages(prompt.messages)) {
            const key = toPromptNameKey(includeName)
            const list = reverseIncludes.get(key) ?? []
            list.push(prompt.name)
            reverseIncludes.set(key, list)
        }
    }
    const defaultByPromptId = new Map<string, string[]>()
    for (const selection of defaults) {
        const list = defaultByPromptId.get(selection.promptId) ?? []
        list.push(selection.category)
        defaultByPromptId.set(selection.promptId, list)
    }
    const skillsByPromptName = new Map<string, string[]>()
    for (const skill of skills) {
        if (!skill.prompt) continue
        const list = skillsByPromptName.get(toPromptNameKey(skill.prompt)) ?? []
        list.push(skill.name)
        skillsByPromptName.set(toPromptNameKey(skill.prompt), list)
    }

    const manifest = {
        schema: 'open-novel-writer/prompt-library-snapshot',
        version: 1,
        exportedAt: new Date().toISOString(),
        promptCount: prompts.length,
        prompts: prompts.map((prompt) => ({
            id: prompt.id,
            name: prompt.name,
            category: prompt.category,
            fileName: `prompts/${prompt.id}.json`,
            includes: extractIncludeNamesFromMessages(prompt.messages),
            includedBy: reverseIncludes.get(toPromptNameKey(prompt.name)) ?? [],
            boundSkills: skillsByPromptName.get(toPromptNameKey(prompt.name)) ?? [],
            defaultFor: defaultByPromptId.get(prompt.id) ?? [],
            sourcePresetId: prompt.sourcePresetId,
            updatedAt: prompt.updatedAt,
        })),
        examples: listBuiltinPromptPresetRegistryEntries().map((entry) => ({
            presetId: entry.summary.presetId,
            name: entry.summary.name,
            entryPromptName: entry.summary.entryPromptName,
            fileName: `examples/${entry.summary.presetId}.json`,
        })),
    }
    const examples = listBuiltinPromptPresetRegistryEntries().map((entry) => ({
        fileName: `${entry.summary.presetId}.json`,
        preset: entry.preset,
    }))
    return { manifest, prompts, examples, unresolvedSkillBindings: skills.filter((skill) => skill.prompt && !byName.has(toPromptNameKey(skill.prompt))).map((skill) => ({ skill: skill.name, prompt: skill.prompt })) }
}
