'use client'

import { create } from 'zustand'
import {
    codexSessionApi,
    type CodexApprovalOption,
    type CodexApprovalRequest,
    type CodexRunEvent,
    type CodexReasoningEffort,
    type CodexReviewLevel,
    type CodexServiceTier,
    type CodexSession,
    type CodexSessionCategory,
    type CodexPromptArtifact,
} from '@/lib/api'
import { dispatchNovelRefreshRequested } from '@/lib/novel-refresh-events'
import { emitSceneEditsChanged } from '@/components/editor/scene-edit-events'
import { emitContinuationPanelRemoved } from '@/lib/continuation-panel-events'

export const EDITOR_CODEX_FALLBACK_NOVEL_ID = '__default__'

const STICKY_REVIEW_LEVEL_KEY = 'codex.reviewLevel'
const DEFAULT_REVIEW_LEVEL: CodexReviewLevel = 'user_review'

function isReviewLevel(value: string | null): value is CodexReviewLevel {
    return value === 'user_review' || value === 'auto_review' || value === 'no_review'
}

function getStickyReviewLevel(): CodexReviewLevel {
    if (typeof window === 'undefined') return DEFAULT_REVIEW_LEVEL
    const stored = window.localStorage.getItem(STICKY_REVIEW_LEVEL_KEY)
    return isReviewLevel(stored) ? stored : DEFAULT_REVIEW_LEVEL
}

function setStickyReviewLevel(reviewLevel: CodexReviewLevel) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STICKY_REVIEW_LEVEL_KEY, reviewLevel)
}

type CodexNovelSessionState = {
    selectedSessionId: string | null
    sessions: CodexSession[]
    loaded: boolean
    loading: boolean
    error: string | null
}

type CodexStoreState = {
    sessionsByNovel: Record<string, CodexNovelSessionState>
    pendingApprovalsBySession: Record<string, CodexApprovalRequest | null>
    loadSessions: (novelId?: string | null) => Promise<void>
    createSession: (novelId?: string | null) => Promise<string | null>
    createSceneOperationSkillSession: (
        novelId: string | null | undefined,
        input: { skillId: string; sceneId: string; draftContent: string; title?: string | null }
    ) => Promise<string | null>
    createSceneContinuationSkillSession: (
        novelId: string | null | undefined,
        input: {
            skillId: string
            sceneId: string
            chapterId: string
            panelId: string
            renderedBlocks?: Array<{ role: string; text: string }>
            draftContent: string
            title?: string | null
        }
    ) => Promise<string | null>
    selectSession: (novelId: string | null | undefined, sessionId: string) => void
    updateDraft: (novelId: string | null | undefined, sessionId: string, draftContent: string) => void
    updateReviewLevel: (novelId: string | null | undefined, sessionId: string, reviewLevel: CodexReviewLevel) => Promise<void>
    updateModelSettings: (
        novelId: string | null | undefined,
        sessionId: string,
        settings: Partial<Pick<CodexSession, 'modelId' | 'reasoningEffort' | 'serviceTier'>>
    ) => Promise<void>
    updatePlanMode: (novelId: string | null | undefined, sessionId: string, planMode: boolean) => Promise<void>
    renameSession: (novelId: string | null | undefined, sessionId: string, title: string) => Promise<void>
    deleteSession: (novelId: string | null | undefined, sessionId: string) => Promise<void>
    sendMessage: (novelId: string | null | undefined, sessionId: string, content: string, options?: { skillIds?: string[]; promptArtifact?: CodexPromptArtifact; attachments?: string[] }) => Promise<void>
    resolveApproval: (
        sessionId: string,
        approvalId: string,
        decision: CodexApprovalOption,
        message?: string
    ) => Promise<void>
}

const draftSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function getNovelKey(novelId?: string | null) {
    const normalized = novelId?.trim()
    return normalized ? normalized : EDITOR_CODEX_FALLBACK_NOVEL_ID
}

function getEmptySession(): CodexNovelSessionState {
    return {
        selectedSessionId: null,
        sessions: [],
        loaded: false,
        loading: false,
        error: null,
    }
}

function createId(prefix: string) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID()}`
    }
    return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

function applySession(
    state: CodexNovelSessionState,
    session: CodexSession,
    options?: { select?: boolean; front?: boolean }
) {
    const existing = state.sessions.filter((item) => item.id !== session.id)
    const sessions = options?.front === false
        ? state.sessions.map((item) => (item.id === session.id ? session : item))
        : [session, ...existing]
    return {
        ...state,
        selectedSessionId: options?.select ? session.id : state.selectedSessionId,
        sessions,
    }
}

function scheduleDraftSave(sessionId: string, draftContent: string) {
    const existing = draftSaveTimers.get(sessionId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
        draftSaveTimers.delete(sessionId)
        void codexSessionApi.update(sessionId, { draftContent }).catch((error) => {
            console.error('Failed to save Codex draft:', error)
        })
    }, 500)
    draftSaveTimers.set(sessionId, timer)
}

function clearDraftSave(sessionId: string) {
    const existing = draftSaveTimers.get(sessionId)
    if (!existing) return
    clearTimeout(existing)
    draftSaveTimers.delete(sessionId)
}

function categoryRank(category: CodexSessionCategory) {
    if (category === 'general') return 0
    if (category === 'scene_operation') return 1
    return 2
}

function sortSessions(sessions: CodexSession[]) {
    return [...sessions].sort((left, right) => {
        const leftRank = categoryRank(left.category)
        const rightRank = categoryRank(right.category)
        if (leftRank !== rightRank) return leftRank - rightRank
        if (left.updatedAt === right.updatedAt) return 0
        return left.updatedAt < right.updatedAt ? 1 : -1
    })
}

function eventToMessage(event: CodexRunEvent): CodexSession['messages'][number] {
    return {
        id: event.id,
        role: 'event',
        kind: event.kind,
        content: [event.title, event.content].filter(Boolean).join('\n\n'),
        attachments: event.attachments,
        createdAt: event.createdAt,
    }
}

function upsertMessage(session: CodexSession, message: CodexSession['messages'][number]) {
    const exists = session.messages.some((item) => item.id === message.id)
    return {
        ...session,
        messages: exists
            ? session.messages.map((item) => (item.id === message.id ? message : item))
            : [...session.messages, message],
    }
}

function appendAssistantDelta(session: CodexSession, event: { delta: string; id?: string; createdAt?: string }) {
    const previous = session.messages[session.messages.length - 1]
    const streamId = event.id || (previous?.role === 'assistant' && previous.id.startsWith('codex_assistant_stream_')
        ? previous.id
        : createId('codex_assistant_stream'))
    const existing = session.messages.find((message) => message.id === streamId)
    return upsertMessage(session, {
        id: streamId,
        role: 'assistant',
        content: `${existing?.content ?? ''}${event.delta}`,
        createdAt: existing?.createdAt ?? event.createdAt ?? new Date().toISOString(),
    })
}

function appendPlanDelta(session: CodexSession, event: { id: string; delta: string; createdAt: string }) {
    const existing = session.messages.find((message) => message.id === event.id)
    const existingContent = existing?.content.split(/\n\n/u).slice(1).join('\n\n') ?? ''
    return upsertMessage(session, {
        id: event.id,
        role: 'event',
        kind: 'plan',
        content: ['Proposed Plan', `${existingContent}${event.delta}`].join('\n\n'),
        createdAt: existing?.createdAt ?? event.createdAt,
    })
}

function attachContextWindow(session: CodexSession, event: { contextWindow: CodexSession['messages'][number]['contextWindow'] }) {
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
        const message = session.messages[index]
        if (message?.role === 'assistant') {
            return {
                ...session,
                messages: session.messages.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, contextWindow: event.contextWindow } : item
                ),
            }
        }
    }
    return session
}

function shouldRefreshNovelAfterCodexEvent(event: CodexRunEvent) {
    return event.kind === 'tool' && event.title.startsWith('opennovelwriter.')
}

export const useEditorCodexStore = create<CodexStoreState>()((set, get) => ({
    sessionsByNovel: {},
    pendingApprovalsBySession: {},
    loadSessions: async (novelId) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID) return

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
            const result = await codexSessionApi.list(novelKey)
            const sessions = sortSessions(result.sessions ?? [])
            set((state) => {
                const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                const selectedSessionId =
                    current.selectedSessionId && sessions.some((session) => session.id === current.selectedSessionId)
                        ? current.selectedSessionId
                        : sessions[0]?.id ?? null
                return {
                    sessionsByNovel: {
                        ...state.sessionsByNovel,
                        [novelKey]: {
                            ...current,
                            selectedSessionId,
                            sessions,
                            loaded: true,
                            loading: false,
                            error: null,
                        },
                    },
                }
            })
        } catch (error) {
            console.error('Failed to load Codex sessions:', error)
            set((state) => {
                const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                return {
                    sessionsByNovel: {
                        ...state.sessionsByNovel,
                        [novelKey]: {
                            ...current,
                            loaded: true,
                            loading: false,
                            error: error instanceof Error ? error.message : String(error),
                        },
                    },
                }
            })
        }
    },
    createSession: async (novelId) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID) return null

        const now = new Date().toISOString()
        const reviewLevel = getStickyReviewLevel()
        const fallback: CodexSession = {
            id: createId('codex_session'),
            category: 'general',
            title: null,
            titleManuallyEdited: false,
            reviewLevel,
            modelId: 'gpt-5.4',
            reasoningEffort: 'high',
            serviceTier: 'standard',
            planMode: false,
            codexThreadId: null,
            codexConnectionId: null,
            draftContent: '',
            status: 'idle',
            lastError: null,
            novelId: novelKey,
            ownerId: '',
            createdAt: now,
            updatedAt: now,
            messages: [],
        }

        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, fallback, { select: true }),
                },
            }
        })

        const result = await codexSessionApi.create(novelKey, { id: fallback.id, category: 'general', reviewLevel })
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, result.session, { select: true, front: false }),
                },
            }
        })
        return result.session.id
    },
    createSceneOperationSkillSession: async (novelId, input) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID) return null

        const result = await codexSessionApi.create(novelKey, {
            category: 'scene_operation',
            skillId: input.skillId,
            sceneId: input.sceneId,
            title: input.title ?? null,
            titleManuallyEdited: Boolean(input.title),
            reviewLevel: getStickyReviewLevel(),
        })
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, result.session, { select: true, front: true }),
                },
            }
        })

        await get().sendMessage(novelKey, result.session.id, input.draftContent, { skillIds: [input.skillId] })
        return result.session.id
    },
    createSceneContinuationSkillSession: async (novelId, input) => {
        // Returns the session id as soon as it exists (the panel locks + switches to "open
        // session" immediately); the message turn runs in the background and the panel picks up
        // Codex's draft writes via its run-gated refresh.
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID) return null

        const result = await codexSessionApi.create(novelKey, {
            category: 'scene_continuation',
            skillId: input.skillId,
            sceneId: input.sceneId,
            chapterId: input.chapterId,
            panelId: input.panelId,
            renderedBlocks: input.renderedBlocks,
            title: input.title ?? null,
            titleManuallyEdited: Boolean(input.title),
            reviewLevel: getStickyReviewLevel(),
        })
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, result.session, { select: true, front: true }),
                },
            }
        })

        void get()
            .sendMessage(novelKey, result.session.id, input.draftContent, { skillIds: [input.skillId] })
            .catch((error) => console.error('Failed to send scene continuation message:', error))
        return result.session.id
    },
    selectSession: (novelId, sessionId) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: { ...current, selectedSessionId: sessionId },
                },
            }
        })
    },
    updateDraft: (novelId, sessionId, draftContent) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId ? { ...session, draftContent } : session
                        ),
                    },
                },
            }
        })
        if (novelKey !== EDITOR_CODEX_FALLBACK_NOVEL_ID) scheduleDraftSave(sessionId, draftContent)
    },
    updateReviewLevel: async (novelId, sessionId, reviewLevel) => {
        const novelKey = getNovelKey(novelId)
        setStickyReviewLevel(reviewLevel)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId ? { ...session, reviewLevel } : session
                        ),
                    },
                },
            }
        })

        const result = await codexSessionApi.update(sessionId, { reviewLevel })
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, result.session, { front: false }),
                },
            }
        })
    },
    updateModelSettings: async (novelId, sessionId, settings) => {
        const novelKey = getNovelKey(novelId)
        const patch: Partial<{
            modelId: string
            reasoningEffort: CodexReasoningEffort
            serviceTier: CodexServiceTier
        }> = {}
        if (settings.modelId) patch.modelId = settings.modelId
        if (settings.reasoningEffort) patch.reasoningEffort = settings.reasoningEffort
        if (settings.serviceTier) patch.serviceTier = settings.serviceTier

        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId ? { ...session, ...patch } : session
                        ),
                    },
                },
            }
        })

        const result = await codexSessionApi.update(sessionId, patch)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, result.session, { front: false }),
                },
            }
        })
    },
    updatePlanMode: async (novelId, sessionId, planMode) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId ? { ...session, planMode } : session
                        ),
                    },
                },
            }
        })

        const result = await codexSessionApi.update(sessionId, { planMode })
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, result.session, { front: false }),
                },
            }
        })
    },
    renameSession: async (novelId, sessionId, title) => {
        const novelKey = getNovelKey(novelId)
        const normalizedTitle = title.trim()
        if (!normalizedTitle) return
        const result = await codexSessionApi.update(sessionId, {
            title: normalizedTitle,
            titleManuallyEdited: true,
        })
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, result.session),
                },
            }
        })
    },
    deleteSession: async (novelId, sessionId) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const sessions = current.sessions.filter((session) => session.id !== sessionId)
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions,
                        selectedSessionId:
                            current.selectedSessionId === sessionId ? sessions[0]?.id ?? null : current.selectedSessionId,
                    },
                },
            }
        })
        if (novelKey !== EDITOR_CODEX_FALLBACK_NOVEL_ID) {
            const result = await codexSessionApi.delete(sessionId)
            // A scene-continuation session is paired with an inline panel; the server removed it
            // from the stored scene HTML, so drop the live node too if that scene is open.
            if (result.removedPanelId) emitContinuationPanelRemoved(result.removedPanelId)
        }
        // The server finalized this session's pending manuscript edits; refresh the review UI.
        emitSceneEditsChanged(novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID ? undefined : novelKey)
    },
    sendMessage: async (novelId, sessionId, content, options) => {
        const novelKey = getNovelKey(novelId)
        clearDraftSave(sessionId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const now = new Date().toISOString()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId
                                ? {
                                    ...session,
                                    status: 'running',
                                    draftContent: '',
                                    messages: [
                                        ...session.messages,
                                        {
                                            id: createId('codex_user'),
                                            role: 'user',
                                            content,
                                            attachments: options?.attachments,
                                            createdAt: now,
                                        },
                                    ],
                                }
                                : session
                        ),
                    },
                },
            }
        })

        let streamError: string | null = null
        await codexSessionApi.streamMessage(sessionId, content, {
            skillIds: options?.skillIds,
            promptArtifact: options?.promptArtifact,
            attachments: options?.attachments,
            onEvent: (event) => {
                if (event.type === 'done') {
                    const session = { ...event.session, draftContent: '' }
                    set((state) => {
                        const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                        return {
                            pendingApprovalsBySession: {
                                ...state.pendingApprovalsBySession,
                                [sessionId]: null,
                            },
                            sessionsByNovel: {
                                ...state.sessionsByNovel,
                                [novelKey]: applySession(current, session, { select: true }),
                            },
                        }
                    })
                    return
                }

                if (event.type === 'error') {
                    streamError = event.detail
                    const session = event.session ? { ...event.session, draftContent: '' } : null
                    set((state) => {
                        const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                        return {
                            pendingApprovalsBySession: {
                                ...state.pendingApprovalsBySession,
                                [sessionId]: null,
                            },
                            sessionsByNovel: {
                                ...state.sessionsByNovel,
                                [novelKey]: session
                                    ? applySession(current, session, { select: true })
                                    : {
                                        ...current,
                                        sessions: current.sessions.map((session) =>
                                            session.id === sessionId
                                                ? { ...session, status: 'error', lastError: event.detail }
                                                : session
                                        ),
                                    },
                            },
                        }
                    })
                    return
                }

                if (event.type === 'approval_request') {
                    set((state) => ({
                        pendingApprovalsBySession: {
                            ...state.pendingApprovalsBySession,
                            [sessionId]: event.approval,
                        },
                    }))
                    return
                }

                if (event.type === 'event' && shouldRefreshNovelAfterCodexEvent(event.event)) {
                    dispatchNovelRefreshRequested({ novelId: novelKey, source: 'codex' })
                }

                set((state) => {
                    const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                    return {
                        sessionsByNovel: {
                            ...state.sessionsByNovel,
                            [novelKey]: {
                                ...current,
                                sessions: current.sessions.map((session) => {
                                    if (session.id !== sessionId) return session
                                    if (event.type === 'assistant_delta') return appendAssistantDelta(session, event)
                                    if (event.type === 'plan_delta') return appendPlanDelta(session, event)
                                    if (event.type === 'context_window') return attachContextWindow(session, event)
                                    return upsertMessage(session, eventToMessage(event.event))
                                }),
                            },
                        },
                    }
                })
            },
        })
        if (streamError) throw new Error(streamError)
    },
    resolveApproval: async (sessionId, approvalId, decision, message) => {
        await codexSessionApi.resolveApproval(sessionId, approvalId, { decision, message })
        set((state) => ({
            pendingApprovalsBySession: {
                ...state.pendingApprovalsBySession,
                [sessionId]: null,
            },
        }))
    },
}))
