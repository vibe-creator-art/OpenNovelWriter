import type { CodexSessionMessage } from '@/lib/server/codex-session'

const stateKey = Symbol.for('openNovelWriter.codexLiveMessages')
const state = globalThis as typeof globalThis & { [stateKey]?: Map<string, CodexSessionMessage[]> }
const messagesBySession = state[stateKey] ??= new Map<string, CodexSessionMessage[]>()

export function registerLiveCodexMessages(sessionId: string, messages: CodexSessionMessage[]) {
    messagesBySession.set(sessionId, messages)
    return () => {
        if (messagesBySession.get(sessionId) === messages) messagesBySession.delete(sessionId)
    }
}

export function getLiveCodexMessages(sessionId: string) {
    return messagesBySession.get(sessionId)
}
