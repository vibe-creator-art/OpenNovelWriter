import type { Prisma } from '@prisma/client'

export type EditorChatConversationRecord = Prisma.EditorChatConversationGetPayload<{
    include: { messages: true }
}>

function safeParseJson(value: string | null | undefined) {
    if (!value) return null
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

function safeParseStringArrayJson(value: string | null | undefined) {
    const parsed = safeParseJson(value)
    if (!Array.isArray(parsed)) return []

    const out: string[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
        const normalized = typeof item === 'string' ? item.trim() : ''
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        out.push(normalized)
    }
    return out
}

export function normalizeStringId(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeString(value: unknown) {
    return typeof value === 'string' ? value : ''
}

export function normalizeJsonString(value: unknown) {
    if (value === undefined) return undefined
    if (value === null) return null
    return JSON.stringify(value)
}

export function serializeEditorChatConversation(record: EditorChatConversationRecord) {
    return {
        id: record.id,
        title: record.title,
        titleManuallyEdited: record.titleManuallyEdited,
        promptId: record.promptId,
        selectedGroupId: record.selectedGroupId,
        draftContent: record.draftContent,
        promptSnapshot: safeParseJson(record.promptSnapshotJson),
        inputState: safeParseJson(record.inputStateJson),
        novelId: record.novelId,
        ownerId: record.ownerId,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        messages: record.messages
            .slice()
            .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
            .map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content,
                sentContent: message.sentContent,
                fullRenderedContent: message.fullRenderedContent,
                promptTokens: message.promptTokens,
                completionTokens: message.completionTokens,
                totalTokens: message.totalTokens,
                termIds: safeParseStringArrayJson(message.termIdsJson),
                attachments: safeParseStringArrayJson(message.attachmentsJson),
                createdAt: message.createdAt.toISOString(),
            })),
    }
}
