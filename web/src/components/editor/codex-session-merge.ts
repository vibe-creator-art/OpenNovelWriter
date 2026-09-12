import type { CodexSession, CodexSessionSummary } from '@/lib/api'

export function mergeSessionSummary(
    local: CodexSession | undefined,
    summary: CodexSessionSummary,
    atRequestStart: CodexSession | undefined,
    hasActiveStream: boolean
): CodexSession {
    if (!local) return { ...summary, messages: [], historyLoaded: false }
    if (local !== atRequestStart || summary.updatedAt < local.updatedAt) return local
    const preserveRunning = local.status === 'running'
        && summary.updatedAt <= local.updatedAt
    return {
        ...local,
        ...summary,
        draftContent: local.draftContent,
        draftAttachments: local.draftAttachments,
        draftArtifacts: local.draftArtifacts,
        status: preserveRunning ? local.status : summary.status,
        historyLoaded: local.historyLoaded && (summary.updatedAt === local.updatedAt
            || (hasActiveStream && summary.status === 'running')),
    }
}

export function mergeServerSession(
    local: CodexSession | undefined,
    server: CodexSession,
    options: { preserveRunning?: boolean } = {}
): CodexSession {
    if (!local) return server
    if (server.updatedAt < local.updatedAt) return local

    const merged: CodexSession = {
        ...server,
        draftContent: local.draftContent,
        draftAttachments: local.draftAttachments,
        draftArtifacts: local.draftArtifacts,
    }
    if (options.preserveRunning !== false && local.status === 'running') {
        merged.status = local.status
        merged.messages = local.messages
        merged.historyLoaded = local.historyLoaded
        merged.messageCount = local.messageCount
        merged.lastError = local.lastError
    }
    return merged
}

export function mergeRefreshedSession(
    local: CodexSession | undefined,
    server: CodexSession,
    atRequestStart: CodexSession | undefined,
    hasActiveStream: boolean
): CodexSession {
    if (local && atRequestStart && (local.messages !== atRequestStart.messages || local.status !== atRequestStart.status)) return local
    if (!local?.historyLoaded) return mergeServerSession(local, server, { preserveRunning: hasActiveStream })
    const serverMessages = new Map(server.messages.map((message) => [message.id, message]))
    const hasUnpersistedProgress = local?.messages.some((message) => {
        if (message.role === 'user') return false
        const persisted = serverMessages.get(message.id)
        return !persisted || persisted.content.length < message.content.length
    }) ?? false
    return mergeServerSession(local, server, {
        preserveRunning: ((hasActiveStream || hasUnpersistedProgress) && server.status === 'running')
            || server.updatedAt <= (local?.updatedAt ?? ''),
    })
}
