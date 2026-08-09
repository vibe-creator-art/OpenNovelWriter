import type { CodexSession } from '@/lib/api'

type CompletionReadState = {
    selectedSessionId: string | null
    sessions: ReadonlyArray<Pick<CodexSession, 'id' | 'unreadCompletionAt'>>
}

function findUnreadCompletionAt(state: CompletionReadState, sessionId: string) {
    return state.sessions.find((session) => session.id === sessionId)?.unreadCompletionAt ?? null
}

export function completionReadAtOnInteraction(state: CompletionReadState, sessionId: string) {
    return findUnreadCompletionAt(state, sessionId)
}

export function completionReadAtOnDraftChange(
    state: CompletionReadState,
    sessionId: string,
    draftContent: string
) {
    if (state.selectedSessionId !== sessionId || !draftContent.trim()) return null
    return findUnreadCompletionAt(state, sessionId)
}
