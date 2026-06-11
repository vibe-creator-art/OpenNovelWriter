'use client'

import { create } from 'zustand'
import { editorChatApi, type EditorChatConversation as ApiEditorChatConversation, type Prompt } from '@/lib/api'

export const EDITOR_CHAT_FALLBACK_NOVEL_ID = '__default__'

export type EditorChatMessage = {
    id: string
    role: 'user' | 'assistant'
    content: string
    sentContent: string | null
    fullRenderedContent: string | null
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    termIds: string[]
    attachments: string[]
    createdAt: string
}

export type EditorChatConversation = {
    id: string
    title: string | null
    titleManuallyEdited: boolean
    promptId: string | null
    selectedGroupId: string | null
    draftContent: string
    promptSnapshot: Prompt | null
    inputState: unknown
    createdAt: string
    updatedAt: string
    messages: EditorChatMessage[]
}

type EditorChatSession = {
    selectedChatId: string | null
    draftContent: string
    draftPromptId: string | null
    draftSelectedGroupId: string | null
    conversations: EditorChatConversation[]
    loaded: boolean
    loading: boolean
    error: string | null
}

type EditorChatState = {
    sessionsByNovel: Record<string, EditorChatSession>
    loadConversations: (novelId?: string | null) => Promise<void>
    createConversation: (
        novelId?: string | null,
        options?: {
            promptId?: string | null
            selectedGroupId?: string | null
            promptSnapshot?: Prompt | null
            inputState?: unknown
        }
    ) => Promise<string>
    selectConversation: (novelId: string | null | undefined, conversationId: string) => void
    updateSessionDraft: (
        novelId: string | null | undefined,
        patch: Partial<Pick<EditorChatSession, 'draftContent' | 'draftPromptId' | 'draftSelectedGroupId'>>
    ) => void
    updateConversation: (
        novelId: string | null | undefined,
        conversationId: string,
        patch: Partial<Pick<EditorChatConversation, 'promptId' | 'selectedGroupId' | 'promptSnapshot' | 'inputState'>>
    ) => Promise<void>
    updateConversationDraft: (novelId: string | null | undefined, conversationId: string, draftContent: string) => void
    renameConversation: (novelId: string | null | undefined, conversationId: string, title: string) => Promise<void>
    cloneConversation: (
        novelId: string | null | undefined,
        conversationId: string,
        options?: { throughMessageId?: string | null }
    ) => Promise<string | null>
    deleteConversation: (novelId: string | null | undefined, conversationId: string) => Promise<void>
    updateMessage: (
        novelId: string | null | undefined,
        conversationId: string,
        messageId: string,
        content: string
    ) => Promise<void>
    deleteMessages: (
        novelId: string | null | undefined,
        conversationId: string,
        messageIds: string[]
    ) => Promise<void>
    appendMessage: (
        novelId: string | null | undefined,
        conversationId: string,
        message: Pick<EditorChatMessage, 'role' | 'content'> & {
            termIds?: string[]
            attachments?: string[]
            sentContent?: string | null
            fullRenderedContent?: string | null
            promptTokens?: number | null
            completionTokens?: number | null
            totalTokens?: number | null
        }
    ) => Promise<void>
}

const draftSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function createId(prefix: string) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID()}`
    }

    return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

function getNovelKey(novelId?: string | null) {
    const normalized = novelId?.trim()
    return normalized ? normalized : EDITOR_CHAT_FALLBACK_NOVEL_ID
}

function getEmptySession(): EditorChatSession {
    return {
        selectedChatId: null,
        draftContent: '',
        draftPromptId: null,
        draftSelectedGroupId: null,
        conversations: [],
        loaded: false,
        loading: false,
        error: null,
    }
}

function toConversationTitle(messages: EditorChatMessage[]) {
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

function reorderConversationToFront(
    conversations: EditorChatConversation[],
    updatedConversation: EditorChatConversation
) {
    return [updatedConversation, ...conversations.filter((conversation) => conversation.id !== updatedConversation.id)]
}

function normalizeStringList(values: string[] | undefined) {
    if (!Array.isArray(values)) return []

    const out: string[] = []
    const seen = new Set<string>()
    for (const value of values) {
        const trimmed = typeof value === 'string' ? value.trim() : ''
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        out.push(trimmed)
    }
    return out
}

function toStoreConversation(conversation: ApiEditorChatConversation): EditorChatConversation {
    return {
        id: conversation.id,
        title: conversation.title,
        titleManuallyEdited: conversation.titleManuallyEdited,
        promptId: conversation.promptId,
        selectedGroupId: conversation.selectedGroupId,
        draftContent: conversation.draftContent,
        promptSnapshot: conversation.promptSnapshot,
        inputState: conversation.inputState,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            sentContent: message.sentContent,
            fullRenderedContent: message.fullRenderedContent,
            promptTokens: message.promptTokens,
            completionTokens: message.completionTokens,
            totalTokens: message.totalTokens,
            termIds: normalizeStringList(message.termIds),
            attachments: normalizeStringList(message.attachments),
            createdAt: message.createdAt,
        })),
    }
}

function scheduleConversationDraftSave(conversationId: string, draftContent: string) {
    const existing = draftSaveTimers.get(conversationId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
        draftSaveTimers.delete(conversationId)
        void editorChatApi.update(conversationId, { draftContent }).catch((error) => {
            console.error('Failed to save chat draft:', error)
        })
    }, 500)
    draftSaveTimers.set(conversationId, timer)
}

function applyConversation(
    session: EditorChatSession,
    conversation: EditorChatConversation,
    options?: { select?: boolean; front?: boolean }
): EditorChatSession {
    const front = options?.front ?? true
    const conversations = front
        ? reorderConversationToFront(session.conversations, conversation)
        : session.conversations.map((item) => (item.id === conversation.id ? conversation : item))

    return {
        ...session,
        selectedChatId: options?.select ? conversation.id : session.selectedChatId,
        conversations,
    }
}

export const useEditorChatStore = create<EditorChatState>()((set, get) => ({
    sessionsByNovel: {},
    loadConversations: async (novelId) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CHAT_FALLBACK_NOVEL_ID) return

        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            if (session.loading) return state
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: { ...session, loading: true, error: null },
                },
            }
        })

        try {
            const result = await editorChatApi.list(novelKey)
            const conversations = (result.conversations ?? []).map(toStoreConversation)
            set((state) => {
                const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
                const selectedChatId =
                    session.selectedChatId && conversations.some((conversation) => conversation.id === session.selectedChatId)
                        ? session.selectedChatId
                        : conversations[0]?.id ?? null
                return {
                    sessionsByNovel: {
                        ...state.sessionsByNovel,
                        [novelKey]: {
                            ...session,
                            selectedChatId,
                            conversations,
                            loaded: true,
                            loading: false,
                            error: null,
                        },
                    },
                }
            })
        } catch (error) {
            console.error('Failed to load editor chats:', error)
            set((state) => {
                const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
                return {
                    sessionsByNovel: {
                        ...state.sessionsByNovel,
                        [novelKey]: {
                            ...session,
                            loaded: true,
                            loading: false,
                            error: error instanceof Error ? error.message : String(error),
                        },
                    },
                }
            })
        }
    },
    createConversation: async (novelId, options) => {
        const novelKey = getNovelKey(novelId)
        const conversationId = createId('chat')
        const now = new Date().toISOString()
        const currentSession = get().sessionsByNovel[novelKey] ?? getEmptySession()
        const draftContent = currentSession.draftContent

        const fallbackConversation: EditorChatConversation = {
            id: conversationId,
            title: null,
            titleManuallyEdited: false,
            promptId: options?.promptId ?? currentSession.draftPromptId ?? null,
            selectedGroupId: options?.selectedGroupId ?? currentSession.draftSelectedGroupId ?? null,
            draftContent,
            promptSnapshot: options?.promptSnapshot ?? null,
            inputState: options?.inputState ?? null,
            createdAt: now,
            updatedAt: now,
            messages: [],
        }

        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...session,
                        selectedChatId: conversationId,
                        draftContent: '',
                        conversations: [fallbackConversation, ...session.conversations],
                    },
                },
            }
        })

        if (novelKey === EDITOR_CHAT_FALLBACK_NOVEL_ID) return conversationId

        const result = await editorChatApi.create(novelKey, {
            id: conversationId,
            promptId: fallbackConversation.promptId,
            selectedGroupId: fallbackConversation.selectedGroupId,
            draftContent,
            promptSnapshot: fallbackConversation.promptSnapshot,
            inputState: fallbackConversation.inputState,
        })
        const conversation = toStoreConversation(result.conversation)

        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, conversation, { select: true, front: false }),
                },
            }
        })

        return conversation.id
    },
    selectConversation: (novelId, conversationId) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...session,
                        selectedChatId: conversationId,
                    },
                },
            }
        })
    },
    updateSessionDraft: (novelId, patch) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const nextSession = { ...session, ...patch }
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: nextSession,
                },
            }
        })
    },
    updateConversation: async (novelId, conversationId, patch) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const currentConversation = session.conversations.find((conversation) => conversation.id === conversationId)
            if (!currentConversation) return state
            const updatedConversation = { ...currentConversation, ...patch, updatedAt: new Date().toISOString() }
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, updatedConversation),
                },
            }
        })

        if (novelKey === EDITOR_CHAT_FALLBACK_NOVEL_ID) return

        const result = await editorChatApi.update(conversationId, patch)
        const conversation = toStoreConversation(result.conversation)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, conversation),
                },
            }
        })
    },
    updateConversationDraft: (novelId, conversationId, draftContent) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const currentConversation = session.conversations.find((conversation) => conversation.id === conversationId)
            if (!currentConversation || currentConversation.draftContent === draftContent) return state

            const updatedConversation: EditorChatConversation = {
                ...currentConversation,
                draftContent,
            }

            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...session,
                        conversations: session.conversations.map((conversation) =>
                            conversation.id === conversationId ? updatedConversation : conversation
                        ),
                    },
                },
            }
        })

        if (novelKey !== EDITOR_CHAT_FALLBACK_NOVEL_ID) {
            scheduleConversationDraftSave(conversationId, draftContent)
        }
    },
    renameConversation: async (novelId, conversationId, title) => {
        const novelKey = getNovelKey(novelId)
        const normalizedTitle = title.trim()
        if (!normalizedTitle) return

        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const currentConversation = session.conversations.find((conversation) => conversation.id === conversationId)
            if (!currentConversation) return state

            const updatedConversation: EditorChatConversation = {
                ...currentConversation,
                title: normalizedTitle,
                titleManuallyEdited: true,
                updatedAt: new Date().toISOString(),
            }

            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, updatedConversation),
                },
            }
        })

        if (novelKey === EDITOR_CHAT_FALLBACK_NOVEL_ID) return
        const result = await editorChatApi.update(conversationId, {
            title: normalizedTitle,
            titleManuallyEdited: true,
        })
        const conversation = toStoreConversation(result.conversation)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, conversation),
                },
            }
        })
    },
    cloneConversation: async (novelId, conversationId, options) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CHAT_FALLBACK_NOVEL_ID) return null

        const result = await editorChatApi.clone(conversationId, { throughMessageId: options?.throughMessageId ?? null })
        const conversation = toStoreConversation(result.conversation)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, conversation, { select: true }),
                },
            }
        })
        return conversation.id
    },
    deleteConversation: async (novelId, conversationId) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const nextConversations = session.conversations.filter((conversation) => conversation.id !== conversationId)
            if (nextConversations.length === session.conversations.length) return state

            const nextSelectedChatId =
                session.selectedChatId === conversationId ? (nextConversations[0]?.id ?? null) : session.selectedChatId

            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...session,
                        selectedChatId: nextSelectedChatId,
                        conversations: nextConversations,
                    },
                },
            }
        })

        if (novelKey !== EDITOR_CHAT_FALLBACK_NOVEL_ID) {
            await editorChatApi.delete(conversationId)
        }
    },
    updateMessage: async (novelId, conversationId, messageId, content) => {
        const novelKey = getNovelKey(novelId)
        const now = new Date().toISOString()

        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const currentConversation = session.conversations.find((conversation) => conversation.id === conversationId)
            if (!currentConversation) return state

            const nextMessages = currentConversation.messages.map((message) =>
                message.id === messageId ? { ...message, content } : message
            )
            const updatedConversation: EditorChatConversation = {
                ...currentConversation,
                messages: nextMessages,
                updatedAt: now,
                title: currentConversation.titleManuallyEdited
                    ? currentConversation.title
                    : toConversationTitle(nextMessages),
            }

            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, updatedConversation),
                },
            }
        })

        if (novelKey === EDITOR_CHAT_FALLBACK_NOVEL_ID) return

        const result = await editorChatApi.updateMessage(conversationId, messageId, { content })
        const conversation = toStoreConversation(result.conversation)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, conversation),
                },
            }
        })
    },
    deleteMessages: async (novelId, conversationId, messageIds) => {
        const novelKey = getNovelKey(novelId)
        const ids = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))]
        if (ids.length === 0) return
        const idSet = new Set(ids)
        const now = new Date().toISOString()

        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const currentConversation = session.conversations.find((conversation) => conversation.id === conversationId)
            if (!currentConversation) return state

            const nextMessages = currentConversation.messages.filter((message) => !idSet.has(message.id))
            const updatedConversation: EditorChatConversation = {
                ...currentConversation,
                messages: nextMessages,
                updatedAt: now,
                title: currentConversation.titleManuallyEdited
                    ? currentConversation.title
                    : toConversationTitle(nextMessages),
            }

            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, updatedConversation),
                },
            }
        })

        if (novelKey === EDITOR_CHAT_FALLBACK_NOVEL_ID) return

        const result = await editorChatApi.deleteMessages(conversationId, ids)
        const conversation = toStoreConversation(result.conversation)
        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, conversation),
                },
            }
        })
    },
    appendMessage: async (novelId, conversationId, message) => {
        const novelKey = getNovelKey(novelId)
        const now = new Date().toISOString()
        const fallbackMessage: EditorChatMessage = {
            id: createId('message'),
            role: message.role,
            content: message.content,
            sentContent: message.sentContent ?? null,
            fullRenderedContent: message.fullRenderedContent ?? null,
            promptTokens: message.promptTokens ?? null,
            completionTokens: message.completionTokens ?? null,
            totalTokens: message.totalTokens ?? null,
            termIds: normalizeStringList(message.termIds),
            attachments: normalizeStringList(message.attachments),
            createdAt: now,
        }

        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const currentConversation = session.conversations.find((conversation) => conversation.id === conversationId)
            if (!currentConversation) return state

            const nextMessages = [...currentConversation.messages, fallbackMessage]
            const updatedConversation: EditorChatConversation = {
                ...currentConversation,
                draftContent: '',
                messages: nextMessages,
                updatedAt: now,
                title: currentConversation.titleManuallyEdited
                    ? currentConversation.title
                    : toConversationTitle(nextMessages),
            }

            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...session,
                        selectedChatId: conversationId,
                        conversations: reorderConversationToFront(session.conversations, updatedConversation),
                    },
                },
            }
        })

        if (novelKey === EDITOR_CHAT_FALLBACK_NOVEL_ID) return

        const result = await editorChatApi.appendMessage(conversationId, {
            role: message.role,
            content: message.content,
            sentContent: message.sentContent ?? null,
            fullRenderedContent: message.fullRenderedContent ?? null,
            promptTokens: message.promptTokens ?? null,
            completionTokens: message.completionTokens ?? null,
            totalTokens: message.totalTokens ?? null,
            termIds: fallbackMessage.termIds,
            attachments: fallbackMessage.attachments,
        })
        const conversation = toStoreConversation(result.conversation)

        set((state) => {
            const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applyConversation(session, conversation, { select: true }),
                },
            }
        })
    },
}))
