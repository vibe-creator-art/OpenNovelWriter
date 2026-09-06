import type { CodexSession } from '@/lib/api'

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
    if (local && local !== atRequestStart) return local
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
