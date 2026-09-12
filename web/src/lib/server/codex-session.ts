import { projectCodexMessage } from '@/lib/server/codex-message-projection'
import { getCodexSessionPreviewTitle, getCodexSessionPreviewText } from '@/lib/codex-message-preview'
import type { CodexWorkMetadata } from '@/lib/codex-work-events'
import type { Prisma } from '@/generated/prisma/client'
import { DEFAULT_CODEX_MODEL } from '@/lib/codex-config'
import { normalizeCodexResponseAnnotations, type CodexResponseAnnotation } from '@/lib/codex-response-annotations'

export type CodexSessionCategory = 'general' | 'scene_operation' | 'scene_continuation'
export type CodexSessionStatus = 'idle' | 'running' | 'error'
export type CodexSessionMessageRole = 'user' | 'assistant' | 'event'
export type CodexReviewLevel = 'user_review' | 'auto_review' | 'no_review' | 'full_access'
export type CodexReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
export type CodexServiceTier = 'standard' | 'fast'
export type CodexComposerMode = 'default' | 'plan' | 'goal'
export type CodexThreadGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'

export type CodexThreadGoal = {
    threadId: string
    objective: string
    status: CodexThreadGoalStatus
    tokenBudget: number | null
    tokensUsed: number
    timeUsedSeconds: number
    createdAt: number
    updatedAt: number
}

export const DEFAULT_CODEX_REVIEW_LEVEL: CodexReviewLevel = 'user_review'
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = 'high'
export const DEFAULT_CODEX_SERVICE_TIER: CodexServiceTier = 'standard'

export type CodexSessionMessage = CodexWorkMetadata & {
    id: string
    role: CodexSessionMessageRole
    content: string
    kind?: string | null
    contextWindow?: CodexContextWindow | null
    /** Managed `/uploads/...` image URLs attached to this message. */
    attachments?: string[]
    /** JSON artifact file names attached to this message's Codex turn. */
    jsonArtifacts?: string[]
    /** Text selected from earlier Codex replies and attached as turn context. */
    responseAnnotations?: CodexResponseAnnotation[]
    sentAsGoal?: boolean
    createdAt: string
}

export type CodexDraftArtifact = {
    fileName: string
    originalName: string
    size: number
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
    if (value === 'user_review' || value === 'auto_review' || value === 'no_review' || value === 'full_access') {
        return value
    }
    return null
}

export function normalizeCodexReasoningEffort(value: unknown): CodexReasoningEffort | null {
    if (
        value === 'none' ||
        value === 'minimal' ||
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

export function normalizeCodexComposerMode(value: unknown): CodexComposerMode | null {
    return value === 'default' || value === 'plan' || value === 'goal' ? value : null
}

export function normalizeCodexThreadGoal(value: unknown): CodexThreadGoal | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const status = record.status
    if (
        status !== 'active' &&
        status !== 'paused' &&
        status !== 'blocked' &&
        status !== 'usageLimited' &&
        status !== 'budgetLimited' &&
        status !== 'complete'
    ) {
        return null
    }
    if (
        typeof record.threadId !== 'string' ||
        typeof record.objective !== 'string' ||
        !record.objective.trim() ||
        (record.tokenBudget !== null && (typeof record.tokenBudget !== 'number' || !Number.isFinite(record.tokenBudget))) ||
        typeof record.tokensUsed !== 'number' ||
        !Number.isFinite(record.tokensUsed) ||
        typeof record.timeUsedSeconds !== 'number' ||
        !Number.isFinite(record.timeUsedSeconds) ||
        typeof record.createdAt !== 'number' ||
        !Number.isFinite(record.createdAt) ||
        typeof record.updatedAt !== 'number' ||
        !Number.isFinite(record.updatedAt)
    ) {
        return null
    }
    return {
        threadId: record.threadId,
        objective: record.objective,
        status,
        tokenBudget: record.tokenBudget,
        tokensUsed: record.tokensUsed,
        timeUsedSeconds: record.timeUsedSeconds,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    }
}

export function parseCodexThreadGoal(value: string | null | undefined) {
    if (!value) return null
    try {
        return normalizeCodexThreadGoal(JSON.parse(value) as unknown)
    } catch {
        return null
    }
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
                const jsonArtifacts = Array.isArray(record.jsonArtifacts)
                    ? record.jsonArtifacts.filter((fileName): fileName is string =>
                        typeof fileName === 'string' && /^[^/\\]+\.json$/i.test(fileName)
                    )
                    : []
                const responseAnnotations = normalizeCodexResponseAnnotations(record.responseAnnotations)
                const sentAsGoal = record.sentAsGoal === true
                return {
                    id,
                    role,
                    content,
                    kind,
                    contextWindow,
                    ...(record.workStatus === 'running' || record.workStatus === 'completed' || record.workStatus === 'failed' || record.workStatus === 'declined' ? { workStatus: record.workStatus } : {}),
                    ...(typeof record.toolInput === 'string' ? { toolInput: record.toolInput } : {}),
                    attachments,
                    jsonArtifacts,
                    ...(responseAnnotations.length ? { responseAnnotations } : {}),
                    ...(sentAsGoal ? { sentAsGoal: true } : {}),
                    createdAt,
                }
            })
            .filter((message): message is CodexSessionMessage => message !== null)
    } catch {
        return []
    }
}

export function parseCodexDraftAttachments(value: string | null | undefined): string[] {
    if (!value) return []
    try {
        const parsed = JSON.parse(value) as unknown
        return Array.isArray(parsed)
            ? parsed.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
            : []
    } catch {
        return []
    }
}

export function parseCodexDraftArtifacts(value: string | null | undefined): CodexDraftArtifact[] {
    if (!value) return []
    try {
        const parsed = JSON.parse(value) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed
            .map((item): CodexDraftArtifact | null => {
                if (!item || typeof item !== 'object') return null
                const record = item as Record<string, unknown>
                if (
                    typeof record.fileName !== 'string' ||
                    !/^[^/\\]+\.json$/i.test(record.fileName) ||
                    typeof record.originalName !== 'string' ||
                    typeof record.size !== 'number' ||
                    !Number.isFinite(record.size) ||
                    record.size < 0
                ) {
                    return null
                }
                return {
                    fileName: record.fileName,
                    originalName: record.originalName,
                    size: record.size,
                }
            })
            .filter((artifact): artifact is CodexDraftArtifact => artifact !== null)
    } catch {
        return []
    }
}

export function serializeCodexSessionSummary(record: CodexSessionRecord, messages = parseCodexSessionMessages(record.messagesJson)) {
    const preview = { ...record, messages }

    return {
        id: record.id,
        category: normalizeCodexSessionCategory(record.category) ?? 'general',
        title: record.title,
        titleManuallyEdited: record.titleManuallyEdited,
        reviewLevel: normalizeCodexReviewLevel(record.reviewLevel) ?? DEFAULT_CODEX_REVIEW_LEVEL,
        modelId: normalizeCodexStringId(record.modelId) ?? DEFAULT_CODEX_MODEL,
        reasoningEffort: normalizeCodexReasoningEffort(record.reasoningEffort) ?? DEFAULT_CODEX_REASONING_EFFORT,
        serviceTier: normalizeCodexServiceTier(record.serviceTier) ?? DEFAULT_CODEX_SERVICE_TIER,
        composerMode: normalizeCodexComposerMode(record.composerMode) ?? 'default',
        goal: parseCodexThreadGoal(record.goalJson),
        codexThreadId: record.codexThreadId,
        codexConnectionId: record.codexConnectionId,
        draftContent: record.draftContent,
        draftAttachments: parseCodexDraftAttachments(record.draftAttachmentsJson),
        draftArtifacts: parseCodexDraftArtifacts(record.draftArtifactsJson),
        status: normalizeCodexSessionStatus(record.status),
        lastError: record.lastError,
        unreadCompletionAt: record.unreadCompletionAt?.toISOString() ?? null,
        novelId: record.novelId,
        ownerId: record.ownerId,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        messageCount: messages.length,
        previewTitle: getCodexSessionPreviewTitle(preview, '').slice(0, 60),
        previewText: getCodexSessionPreviewText(preview, '').slice(0, 240),
    }
}

export function serializeCodexSession(record: CodexSessionRecord, messages = parseCodexSessionMessages(record.messagesJson)) {
    return {
        ...serializeCodexSessionSummary(record, messages),
        historyLoaded: true,
        messages: messages.map(projectCodexMessage),
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
