import type { Prisma } from '@prisma/client'
import { DEFAULT_CODEX_MODEL } from '@/lib/codex-config'

export type CodexSessionCategory = 'general' | 'scene_operation' | 'scene_continuation'
export type CodexSessionStatus = 'idle' | 'running' | 'error'
export type CodexSessionMessageRole = 'user' | 'assistant' | 'event'
export type CodexReviewLevel = 'user_review' | 'auto_review' | 'no_review'
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
export type CodexServiceTier = 'standard' | 'fast'

export const DEFAULT_CODEX_REVIEW_LEVEL: CodexReviewLevel = 'user_review'
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = 'high'
export const DEFAULT_CODEX_SERVICE_TIER: CodexServiceTier = 'standard'

export type CodexSessionMessage = {
    id: string
    role: CodexSessionMessageRole
    content: string
    kind?: string | null
    contextWindow?: CodexContextWindow | null
    /** Managed `/uploads/...` image URLs attached to this message. */
    attachments?: string[]
    createdAt: string
}

export type CodexTokenUsage = {
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    totalTokens: number
}

export type CodexContextWindow = {
    usedTokens: number
    totalTokens: number
    usagePercent: number
    remainingTokens: number
    lastTokenUsage: CodexTokenUsage | null
    totalTokenUsage: CodexTokenUsage | null
}

export type CodexSessionRecord = Prisma.CodexSessionGetPayload<object>

export function normalizeCodexSessionCategory(value: unknown): CodexSessionCategory | null {
    if (value === 'general' || value === 'scene_operation' || value === 'scene_continuation') {
        return value
    }
    return null
}

export function normalizeCodexSessionStatus(value: string): CodexSessionStatus {
    return value === 'running' || value === 'error' ? value : 'idle'
}

export function normalizeCodexReviewLevel(value: unknown): CodexReviewLevel | null {
    if (value === 'user_review' || value === 'auto_review' || value === 'no_review') {
        return value
    }
    return null
}

export function normalizeCodexReasoningEffort(value: unknown): CodexReasoningEffort | null {
    if (
        value === 'low' ||
        value === 'medium' ||
        value === 'high' ||
        value === 'xhigh' ||
        value === 'max' ||
        value === 'ultra'
    ) {
        return value
    }
    return null
}

export function normalizeCodexServiceTier(value: unknown): CodexServiceTier | null {
    if (value === 'standard' || value === 'fast') {
        return value
    }
    return null
}

export function normalizeCodexString(value: unknown) {
    return typeof value === 'string' ? value : ''
}

export function normalizeCodexStringId(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeCodexNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeCodexTokenUsage(value: unknown): CodexTokenUsage | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const inputTokens = normalizeCodexNumber(record.inputTokens)
    const cachedInputTokens = normalizeCodexNumber(record.cachedInputTokens)
    const outputTokens = normalizeCodexNumber(record.outputTokens)
    const reasoningOutputTokens = normalizeCodexNumber(record.reasoningOutputTokens)
    const totalTokens = normalizeCodexNumber(record.totalTokens)
    if (
        inputTokens === null ||
        cachedInputTokens === null ||
        outputTokens === null ||
        reasoningOutputTokens === null ||
        totalTokens === null
    ) {
        return null
    }
    return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens }
}

function normalizeCodexContextWindow(value: unknown): CodexContextWindow | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const usedTokens = normalizeCodexNumber(record.usedTokens)
    const totalTokens = normalizeCodexNumber(record.totalTokens)
    const usagePercent = normalizeCodexNumber(record.usagePercent)
    const remainingTokens = normalizeCodexNumber(record.remainingTokens)
    if (usedTokens === null || totalTokens === null || usagePercent === null || remainingTokens === null) return null
    return {
        usedTokens,
        totalTokens,
        usagePercent,
        remainingTokens,
        lastTokenUsage: normalizeCodexTokenUsage(record.lastTokenUsage),
        totalTokenUsage: normalizeCodexTokenUsage(record.totalTokenUsage),
    }
}

export function createCodexMessageId(prefix = 'codex_message') {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID()}`
    }
    return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

export function parseCodexSessionMessages(value: string | null | undefined): CodexSessionMessage[] {
    if (!value) return []

    try {
        const parsed = JSON.parse(value) as unknown
        if (!Array.isArray(parsed)) return []

        return parsed
            .map((item): CodexSessionMessage | null => {
                if (!item || typeof item !== 'object') return null
                const record = item as Record<string, unknown>
                const role = record.role
                if (role !== 'user' && role !== 'assistant' && role !== 'event') return null
                const id = normalizeCodexStringId(record.id) ?? createCodexMessageId()
                const content = normalizeCodexString(record.content)
                const createdAt = normalizeCodexStringId(record.createdAt) ?? new Date().toISOString()
                const kind = typeof record.kind === 'string' && record.kind.trim() ? record.kind.trim() : null
                const contextWindow = normalizeCodexContextWindow(record.contextWindow)
                const attachments = Array.isArray(record.attachments)
                    ? record.attachments.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
                    : []
                return { id, role, content, kind, contextWindow, attachments, createdAt }
            })
            .filter((message): message is CodexSessionMessage => message !== null)
    } catch {
        return []
    }
}

export function serializeCodexSession(record: CodexSessionRecord) {
    return {
        id: record.id,
        category: normalizeCodexSessionCategory(record.category) ?? 'general',
        title: record.title,
        titleManuallyEdited: record.titleManuallyEdited,
        reviewLevel: normalizeCodexReviewLevel(record.reviewLevel) ?? DEFAULT_CODEX_REVIEW_LEVEL,
        modelId: normalizeCodexStringId(record.modelId) ?? DEFAULT_CODEX_MODEL,
        reasoningEffort: normalizeCodexReasoningEffort(record.reasoningEffort) ?? DEFAULT_CODEX_REASONING_EFFORT,
        serviceTier: normalizeCodexServiceTier(record.serviceTier) ?? DEFAULT_CODEX_SERVICE_TIER,
        planMode: record.planMode,
        codexThreadId: record.codexThreadId,
        codexConnectionId: record.codexConnectionId,
        draftContent: record.draftContent,
        status: normalizeCodexSessionStatus(record.status),
        lastError: record.lastError,
        novelId: record.novelId,
        ownerId: record.ownerId,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        messages: parseCodexSessionMessages(record.messagesJson),
    }
}

export function createCodexSessionTitle(messages: CodexSessionMessage[]) {
    const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim())
    if (!firstUserMessage) return null

    const normalized = firstUserMessage.content.trim().replace(/\s+/g, ' ')
    const firstLine = normalized.split(/\r?\n/u)[0] ?? normalized
    const sentenceMatch = firstLine.match(/^(.+?[。！？!?\.])(?:\s|$)/u)
    const baseTitle = (sentenceMatch?.[1] ?? firstLine).trim()
    if (!baseTitle) return null
    if (baseTitle.length <= 28) return baseTitle
    return `${baseTitle.slice(0, 28).trimEnd()}...`
}
