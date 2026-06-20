import {
    isPromptMessageRole,
    normalizePromptAgentCallMode,
    normalizePromptCategory,
    type PromptCategory,
    type PromptMessage,
} from '@/lib/prompts'
import { normalizePromptInputs, type PromptInputDefinition } from '@/lib/prompt-inputs'
import { safeParseRevisionHistoryJson } from '@/lib/revision-history'

function createMessageId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `m_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

function safeJsonParse(value: string): unknown {
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

function normalizeMessagesArray(promptId: string, input: unknown): PromptMessage[] {
    if (!Array.isArray(input)) return []
    return input
        .map((item, index) => {
            const id =
                typeof item?.id === 'string' && item.id.trim()
                    ? item.id.trim()
                    : `${promptId}-m${index}`
            const role = isPromptMessageRole(item?.role) ? item.role : null
            const content = typeof item?.content === 'string' ? item.content : ''
            if (!role) return null
            return { id, role, content }
        })
        .filter((item): item is PromptMessage => item !== null)
}

function safeParseStringArrayJson(value: string | null | undefined): string[] {
    if (!value) return []
    try {
        const parsed = JSON.parse(value) as unknown
        if (!Array.isArray(parsed)) return []

        const seen = new Set<string>()
        const result: string[] = []
        for (const item of parsed) {
            if (typeof item !== 'string') continue
            const trimmed = item.trim()
            if (!trimmed || seen.has(trimmed)) continue
            seen.add(trimmed)
            result.push(trimmed)
        }
        return result
    } catch {
        return []
    }
}

function normalizeStoredInputs(promptId: string, inputsJson: string | null | undefined): PromptInputDefinition[] {
    const parsed = safeJsonParse(typeof inputsJson === 'string' ? inputsJson : '')
    const inputs = normalizePromptInputs(parsed)
    return inputs.map((item, index) => ({
        ...item,
        id: item.id?.trim() ? item.id : `${promptId}-in${index}`,
    }))
}

function getDefaultMessages(category: PromptCategory): PromptMessage[] {
    if (category === 'component') {
        return [{ id: createMessageId(), role: 'assistant', content: '' }]
    }
    return [{ id: createMessageId(), role: 'system', content: '' }]
}

export function normalizeStoredMessages(params: {
    promptId: string
    category: string
    messagesJson: string | null
}): PromptMessage[] {
    const parsed = normalizeMessagesArray(
        params.promptId,
        safeJsonParse(typeof params.messagesJson === 'string' ? params.messagesJson : '')
    )

    if (params.category === 'component') {
        const first = parsed.find((m) => m.role === 'user' || m.role === 'assistant') ?? null
        if (first) return [first]
        return [{ id: `${params.promptId}-message`, role: 'assistant', content: '' }]
    }

    const system = parsed.find((m) => m.role === 'system') ?? null
    const rest = parsed.filter((m) => m.role === 'user' || m.role === 'assistant')
    return [system ?? { id: `${params.promptId}-system`, role: 'system', content: '' }, ...rest]
}

export function normalizeIncomingMessages(params: {
    category: PromptCategory
    messages: unknown
}): { ok: true; messages: PromptMessage[] } | { ok: false; detail: string } {
    if (params.messages == null) {
        return { ok: true, messages: getDefaultMessages(params.category) }
    }

    if (!Array.isArray(params.messages)) {
        return { ok: false, detail: 'Invalid messages' }
    }

    const raw = params.messages as unknown[]
    const messages = raw
        .map((item) => {
            const obj: Record<string, unknown> =
                typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
            const id =
                typeof obj.id === 'string' && obj.id.trim()
                    ? obj.id.trim()
                    : createMessageId()
            const role = isPromptMessageRole(obj.role) ? obj.role : null
            const content = typeof obj.content === 'string' ? obj.content : ''
            if (!role) return null
            return { id, role, content }
        })
        .filter((item): item is PromptMessage => item !== null)

    if (params.category === 'component') {
        if (messages.length !== 1) return { ok: false, detail: 'Component prompts must have exactly one message' }
        if (messages[0].role === 'system') return { ok: false, detail: 'Component message cannot be system role' }
        return { ok: true, messages }
    }

    if (messages.length < 1) return { ok: false, detail: 'Prompts must have at least one message' }
    if (messages[0].role !== 'system') return { ok: false, detail: 'First message must be a system message' }
    if (messages.slice(1).some((m) => m.role === 'system')) {
        return { ok: false, detail: 'Only the first message can be system role' }
    }

    return { ok: true, messages }
}

export function getPromptPrimaryMessageContent(messages: PromptMessage[]): string {
    return messages[0]?.content ?? ''
}

type PromptRecord = {
    id: string
    name: string
    category: string
    description: string | null
    messagesJson: string
    inputsJson?: string | null
    modelGroupIdsJson?: string | null
    modelSetIdsJson?: string | null
    allowLlmCall?: boolean | null
    allowAgentCall?: boolean | null
    agentCallMode?: string | null
    historyJson?: string | null
    isNsfw?: boolean | null
    sortOrder: number
    sourcePresetId?: string | null
    sourcePresetRevision?: number | null
    ownerId: string
    createdAt: Date
    updatedAt: Date
}

export function toPromptDto(record: PromptRecord) {
    const normalizedCategory = normalizePromptCategory(record.category)
    const dtoCategory = normalizedCategory ?? record.category

    const messages = normalizeStoredMessages({
        promptId: record.id,
        category: dtoCategory,
        messagesJson: record.messagesJson ?? null,
    })

    const inputs = normalizeStoredInputs(record.id, record.inputsJson)
    const history = safeParseRevisionHistoryJson(record.historyJson, { idPrefix: 'prompt' })
    const modelGroupIds = safeParseStringArrayJson(record.modelGroupIdsJson ?? null)
    const modelSetIds = safeParseStringArrayJson(record.modelSetIdsJson ?? null)
    const isComponent = dtoCategory === 'component'

    return {
        id: record.id,
        name: record.name,
        category: dtoCategory,
        description: record.description,
        messages,
        inputs,
        modelGroupIds,
        modelSetIds,
        allowLlmCall: isComponent ? false : Boolean(record.allowLlmCall),
        allowAgentCall: isComponent ? false : Boolean(record.allowAgentCall),
        agentCallMode: normalizePromptAgentCallMode(record.agentCallMode),
        history,
        isNsfw: Boolean(record.isNsfw),
        sortOrder: record.sortOrder,
        sourcePresetId: record.sourcePresetId ?? null,
        sourcePresetRevision: record.sourcePresetRevision ?? null,
        ownerId: record.ownerId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    }
}

export function getPromptApiErrorDetail(error: unknown): string {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = rawMessage.trim() || 'Internal server error'
    const normalized = message.toLowerCase()

    const looksLikeMigrationIssue =
        normalized.includes('p2021') ||
        normalized.includes('p2022') ||
        normalized.includes('no such table') ||
        normalized.includes('no such column') ||
        (normalized.includes('does not exist') && normalized.includes('prompt'))

    if (looksLikeMigrationIssue) {
        return 'Database schema is out of date. Run `prisma generate` and apply migrations (`prisma migrate dev` or `prisma migrate deploy`).'
    }

    if (process.env.NODE_ENV !== 'production') return message
    return 'Internal server error'
}
