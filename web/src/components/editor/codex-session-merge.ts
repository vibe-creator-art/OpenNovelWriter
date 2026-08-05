import type { CodexSession } from '@/lib/api'

export function mergeServerSession(
    local: CodexSession | undefined,
    server: CodexSession,
    options: { preserveRunning?: boolean } = {}
): CodexSession {
    if (!local) return server

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
