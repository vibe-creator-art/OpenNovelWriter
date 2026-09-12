import type { CodexSession } from '@/lib/api'

const CODEX_INLINE_REFERENCE_RE = /\[([^\]\r\n]+)\]\((?:model|skill|term|snippet|material|outlineChapter|outlineAct|chapter|act|scene|continuation|image|llm):[^)\r\n]+\)/g

export function flattenCodexMessagePreview(content: string) {
    return content
        .replace(CODEX_INLINE_REFERENCE_RE, (_match, label: string) => label)
        .trim()
        .replace(/\s+/g, ' ')
}

export function getCodexSessionPreviewTitle(
    session: Pick<CodexSession, 'title' | 'titleManuallyEdited'> & { messages?: CodexSession['messages']; previewTitle?: string; historyLoaded?: boolean },
    fallback: string
) {
    if (session.titleManuallyEdited && session.title?.trim()) {
        return flattenCodexMessagePreview(session.title)
    }
    if (session.previewTitle !== undefined && (!session.messages || session.historyLoaded === false)) return session.previewTitle || fallback
    const firstUser = session.messages?.find((message) => message.role === 'user' && message.content.trim())
    if (firstUser) return flattenCodexMessagePreview(firstUser.content).slice(0, 60) || fallback
    return session.title ? flattenCodexMessagePreview(session.title) || fallback : fallback
}

export function getCodexSessionPreviewText(
    session: Pick<CodexSession, 'draftContent'> & { messages?: CodexSession['messages']; previewText?: string; historyLoaded?: boolean },
    fallback: string
) {
    if (session.previewText !== undefined && (!session.messages || session.historyLoaded === false)) return session.previewText || flattenCodexMessagePreview(session.draftContent) || fallback
    const lastMessage = [...(session.messages ?? [])].reverse().find((message) => message.role !== 'event' && message.content.trim())
    const content = lastMessage?.content || session.draftContent
    return content ? flattenCodexMessagePreview(content) || fallback : fallback
}
