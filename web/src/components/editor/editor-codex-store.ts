'use client'

import { create, type StoreApi } from 'zustand'
import {
    codexSessionApi,
    type CodexApprovalOption,
    type CodexApprovalRequest,
    type CodexRunEvent,
    type CodexSessionStreamEvent,
    type CodexReasoningEffort,
    type CodexReviewLevel,
    type CodexServiceTier,
    type CodexSession,
    type CodexSessionCategory,
    type CodexSessionCleanupResult,
    type CodexPromptArtifact,
    type CodexDraftArtifact,
} from '@/lib/api'
import type { PendingImageAttachment } from '@/components/image/use-image-attachments'
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

export type QueuedCodexMessage = {
    id: string
    content: string
    attachments: string[]
    createdAt: string
}

type DraftSessionPatch = Partial<Pick<CodexSession, 'draftContent' | 'draftAttachments' | 'draftArtifacts'>>

type CodexStoreState = {
    sessionsByNovel: Record<string, CodexNovelSessionState>
    pendingApprovalsBySession: Record<string, CodexApprovalRequest | null>
    imageAttachmentsBySession: Record<string, PendingImageAttachment[]>
    jsonArtifactUploadingBySession: Record<string, boolean>
    queuedMessagesBySession: Record<string, QueuedCodexMessage[]>
    queueingEnabledBySession: Record<string, boolean>
    optimisticSteerMessagesBySession: Record<string, CodexSession['messages']>
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
    updateImageAttachments: (
        novelId: string | null | undefined,
        sessionId: string,
        items: PendingImageAttachment[]
    ) => void
    updateDraftArtifacts: (
        novelId: string | null | undefined,
        sessionId: string,
        artifacts: CodexDraftArtifact[]
    ) => void
    setJsonArtifactUploading: (sessionId: string, uploading: boolean) => void
    setQueuedMessages: (
        sessionId: string,
        updater: (current: QueuedCodexMessage[]) => QueuedCodexMessage[]
    ) => void
    setQueueingEnabled: (sessionId: string, enabled: boolean) => void
    setOptimisticSteerMessages: (
        sessionId: string,
        updater: (current: CodexSession['messages']) => CodexSession['messages']
    ) => void
    updateReviewLevel: (novelId: string | null | undefined, sessionId: string, reviewLevel: CodexReviewLevel) => Promise<void>
    updateModelSettings: (
        novelId: string | null | undefined,
        sessionId: string,
        settings: Partial<Pick<CodexSession, 'modelId' | 'reasoningEffort' | 'serviceTier'>>
    ) => Promise<void>
    updatePlanMode: (novelId: string | null | undefined, sessionId: string, planMode: boolean) => Promise<void>
    renameSession: (novelId: string | null | undefined, sessionId: string, title: string) => Promise<void>
    deleteSession: (novelId: string | null | undefined, sessionId: string) => Promise<void>
    sendMessage: (novelId: string | null | undefined, sessionId: string, content: string, options?: { skillIds?: string[]; promptArtifact?: CodexPromptArtifact; attachments?: string[]; artifactFiles?: string[] }) => Promise<void>
    compact: (novelId: string | null | undefined, sessionId: string) => Promise<void>
    resolveApproval: (
        sessionId: string,
        approvalId: string,
        decision: CodexApprovalOption,
        message?: string
    ) => Promise<void>
}

const draftSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingDraftPatches = new Map<string, DraftSessionPatch>()
const sessionLoadPromises = new Map<string, Promise<void>>()
const sessionCreatePromises = new Map<string, Promise<string | null>>()

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

function removePrunedSessions(state: CodexNovelSessionState, cleanup: CodexSessionCleanupResult) {
    if (cleanup.deletedSessionIds.length === 0) return state
    const deletedIds = new Set(cleanup.deletedSessionIds)
    const sessions = state.sessions.filter((session) => !deletedIds.has(session.id))
    return {
        ...state,
        sessions,
        selectedSessionId:
            state.selectedSessionId && deletedIds.has(state.selectedSessionId)
                ? sessions[0]?.id ?? null
                : state.selectedSessionId,
    }
}

function finishSessionCleanup(cleanup: CodexSessionCleanupResult) {
    cleanup.deletedSessionIds.forEach(clearDraftSave)
}

function scheduleDraftSave(sessionId: string, patch: DraftSessionPatch) {
    const existing = draftSaveTimers.get(sessionId)
    if (existing) clearTimeout(existing)
    pendingDraftPatches.set(sessionId, { ...pendingDraftPatches.get(sessionId), ...patch })

    const timer = setTimeout(() => {
        draftSaveTimers.delete(sessionId)
        const pendingPatch = pendingDraftPatches.get(sessionId)
        pendingDraftPatches.delete(sessionId)
        if (!pendingPatch) return
        void codexSessionApi.update(sessionId, pendingPatch).catch((error) => {
            console.error('Failed to save Codex draft:', error)
        })
    }, 500)
    draftSaveTimers.set(sessionId, timer)
}

function clearDraftSave(sessionId: string) {
    const pendingPatch = pendingDraftPatches.get(sessionId)
    const existing = draftSaveTimers.get(sessionId)
    if (existing) clearTimeout(existing)
    draftSaveTimers.delete(sessionId)
    pendingDraftPatches.delete(sessionId)
    return pendingPatch
}

function restoreDraftImageAttachments(session: CodexSession): PendingImageAttachment[] {
    return session.draftAttachments.map((url, index) => ({
        id: `codex_draft_attachment_${session.id}_${index}`,
        status: 'ready',
        url,
        previewUrl: url,
    }))
}

function mergeSessionPreservingComposer(current: CodexNovelSessionState, session: CodexSession) {
    const local = current.sessions.find((item) => item.id === session.id)
    return local
        ? {
            ...session,
            draftContent: local.draftContent,
            draftAttachments: local.draftAttachments,
            draftArtifacts: local.draftArtifacts,
        }
        : session
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

/**
 * Reduce a single Codex SSE event into store state. Shared by `sendMessage` and `compact` so both
 * streams handle done/error/approval/deltas/events identically. Returns the error detail when the
 * event is an `error` (so the caller can rethrow once the stream ends), otherwise null.
 */
function applyCodexStreamEvent(
    set: StoreApi<CodexStoreState>['setState'],
    novelKey: string,
    sessionId: string,
    event: CodexSessionStreamEvent
): string | null {
    if (event.type === 'done') {
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const session = mergeSessionPreservingComposer(current, event.session)
            return {
                pendingApprovalsBySession: {
                    ...state.pendingApprovalsBySession,
                    [sessionId]: null,
                },
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, session),
                },
            }
        })
        return null
    }

    if (event.type === 'error') {
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const session = event.session ? mergeSessionPreservingComposer(current, event.session) : null
            return {
                pendingApprovalsBySession: {
                    ...state.pendingApprovalsBySession,
                    [sessionId]: null,
                },
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: session
                        ? applySession(current, session)
                        : {
                            ...current,
                            sessions: current.sessions.map((item) =>
                                item.id === sessionId
                                    ? { ...item, status: 'error', lastError: event.detail }
                                    : item
                            ),
                        },
                },
            }
        })
        return event.detail
    }

    if (event.type === 'approval_request') {
        set((state) => ({
            pendingApprovalsBySession: {
                ...state.pendingApprovalsBySession,
                [sessionId]: event.approval,
            },
        }))
        return null
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
    return null
}

export const useEditorCodexStore = create<CodexStoreState>()((set, get) => ({
    sessionsByNovel: {},
    pendingApprovalsBySession: {},
    imageAttachmentsBySession: {},
    jsonArtifactUploadingBySession: {},
    queuedMessagesBySession: {},
    queueingEnabledBySession: {},
    optimisticSteerMessagesBySession: {},
    loadSessions: async (novelId) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID) return
        if (get().sessionsByNovel[novelKey]?.loaded) return
        const pendingLoad = sessionLoadPromises.get(novelKey)
        if (pendingLoad) return pendingLoad

        const sessionIdsAtStart = new Set(
            (get().sessionsByNovel[novelKey]?.sessions ?? []).map((session) => session.id)
        )
        const loadPromise = (async () => {
            set((state) => {
                const session = state.sessionsByNovel[novelKey] ?? getEmptySession()
                return {
                    sessionsByNovel: {
                        ...state.sessionsByNovel,
                        [novelKey]: { ...session, loading: true, error: null },
                    },
                }
            })

            try {
                const result = await codexSessionApi.list(novelKey)
                set((state) => {
                    const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                    const currentById = new Map(current.sessions.map((session) => [session.id, session]))
                    const serverIds = new Set(result.sessions.map((session) => session.id))
                    const sessions = sortSessions([
                        ...result.sessions.map((session) => currentById.get(session.id) ?? session),
                        ...current.sessions.filter(
                            (session) => !serverIds.has(session.id) && !sessionIdsAtStart.has(session.id)
                        ),
                    ])
                    const selectedSessionId =
                        current.selectedSessionId && sessions.some((session) => session.id === current.selectedSessionId)
                            ? current.selectedSessionId
                            : sessions[0]?.id ?? null
                    const imageAttachmentsBySession = { ...state.imageAttachmentsBySession }
                    sessions.forEach((session) => {
                        if (!Object.hasOwn(imageAttachmentsBySession, session.id)) {
                            imageAttachmentsBySession[session.id] = restoreDraftImageAttachments(session)
                        }
                    })
                    return {
                        imageAttachmentsBySession,
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
        })()
        sessionLoadPromises.set(novelKey, loadPromise)
        try {
            await loadPromise
        } finally {
            sessionLoadPromises.delete(novelKey)
        }
    },
    createSession: async (novelId) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID) return null
        const pendingCreate = sessionCreatePromises.get(novelKey)
        if (pendingCreate) return pendingCreate

        const createPromise = (async () => {
            await get().loadSessions(novelKey)
            const reusableDraft = get().sessionsByNovel[novelKey]?.sessions.find(
                (session) => session.category === 'general' && session.messages.length === 0
            )
            if (reusableDraft) {
                get().selectSession(novelKey, reusableDraft.id)
                return reusableDraft.id
            }

            const result = await codexSessionApi.create(novelKey, {
                category: 'general',
                reviewLevel: getStickyReviewLevel(),
            })
            set((state) => {
                const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                const cleaned = removePrunedSessions(current, result.codexSessionCleanup)
                return {
                    imageAttachmentsBySession: {
                        ...state.imageAttachmentsBySession,
                        [result.session.id]: restoreDraftImageAttachments(result.session),
                    },
                    sessionsByNovel: {
                        ...state.sessionsByNovel,
                        [novelKey]: applySession(cleaned, result.session, { select: true, front: true }),
                    },
                }
            })
            finishSessionCleanup(result.codexSessionCleanup)
            return result.session.id
        })()
        sessionCreatePromises.set(novelKey, createPromise)
        try {
            return await createPromise
        } finally {
            sessionCreatePromises.delete(novelKey)
        }
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
            const cleaned = removePrunedSessions(current, result.codexSessionCleanup)
            return {
                imageAttachmentsBySession: {
                    ...state.imageAttachmentsBySession,
                    [result.session.id]: restoreDraftImageAttachments(result.session),
                },
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(cleaned, result.session, { select: true, front: true }),
                },
            }
        })
        finishSessionCleanup(result.codexSessionCleanup)

        void get()
            .sendMessage(novelKey, result.session.id, input.draftContent, { skillIds: [input.skillId] })
            .catch((error) => console.error('Failed to send scene operation message:', error))
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
            const cleaned = removePrunedSessions(current, result.codexSessionCleanup)
            return {
                imageAttachmentsBySession: {
                    ...state.imageAttachmentsBySession,
                    [result.session.id]: restoreDraftImageAttachments(result.session),
                },
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(cleaned, result.session, { select: true, front: true }),
                },
            }
        })
        finishSessionCleanup(result.codexSessionCleanup)

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
        if (novelKey !== EDITOR_CODEX_FALLBACK_NOVEL_ID) {
            scheduleDraftSave(sessionId, { draftContent })
        }
    },
    updateImageAttachments: (novelId, sessionId, items) => {
        const novelKey = getNovelKey(novelId)
        const draftAttachments = items
            .filter((item): item is PendingImageAttachment & { url: string } =>
                item.status === 'ready' && item.url !== null
            )
            .map((item) => item.url)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                imageAttachmentsBySession: {
                    ...state.imageAttachmentsBySession,
                    [sessionId]: items,
                },
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId ? { ...session, draftAttachments } : session
                        ),
                    },
                },
            }
        })
        if (novelKey !== EDITOR_CODEX_FALLBACK_NOVEL_ID) {
            scheduleDraftSave(sessionId, { draftAttachments })
        }
    },
    updateDraftArtifacts: (novelId, sessionId, draftArtifacts) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId ? { ...session, draftArtifacts } : session
                        ),
                    },
                },
            }
        })
        if (novelKey !== EDITOR_CODEX_FALLBACK_NOVEL_ID) {
            scheduleDraftSave(sessionId, { draftArtifacts })
        }
    },
    setJsonArtifactUploading: (sessionId, uploading) => {
        set((state) => ({
            jsonArtifactUploadingBySession: {
                ...state.jsonArtifactUploadingBySession,
                [sessionId]: uploading,
            },
        }))
    },
    setQueuedMessages: (sessionId, updater) => {
        set((state) => ({
            queuedMessagesBySession: {
                ...state.queuedMessagesBySession,
                [sessionId]: updater(state.queuedMessagesBySession[sessionId] ?? []),
            },
        }))
    },
    setQueueingEnabled: (sessionId, enabled) => {
        set((state) => ({
            queueingEnabledBySession: {
                ...state.queueingEnabledBySession,
                [sessionId]: enabled,
            },
        }))
    },
    setOptimisticSteerMessages: (sessionId, updater) => {
        set((state) => ({
            optimisticSteerMessagesBySession: {
                ...state.optimisticSteerMessagesBySession,
                [sessionId]: updater(state.optimisticSteerMessagesBySession[sessionId] ?? []),
            },
        }))
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
                    [novelKey]: applySession(
                        current,
                        mergeSessionPreservingComposer(current, result.session),
                        { front: false }
                    ),
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
                    [novelKey]: applySession(
                        current,
                        mergeSessionPreservingComposer(current, result.session),
                        { front: false }
                    ),
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
                    [novelKey]: applySession(
                        current,
                        mergeSessionPreservingComposer(current, result.session),
                        { front: false }
                    ),
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
                    [novelKey]: applySession(current, mergeSessionPreservingComposer(current, result.session)),
                },
            }
        })
    },
    deleteSession: async (novelId, sessionId) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const sessions = current.sessions.filter((session) => session.id !== sessionId)
            const imageAttachmentsBySession = { ...state.imageAttachmentsBySession }
            const jsonArtifactUploadingBySession = { ...state.jsonArtifactUploadingBySession }
            const queuedMessagesBySession = { ...state.queuedMessagesBySession }
            const queueingEnabledBySession = { ...state.queueingEnabledBySession }
            const optimisticSteerMessagesBySession = { ...state.optimisticSteerMessagesBySession }
            delete imageAttachmentsBySession[sessionId]
            delete jsonArtifactUploadingBySession[sessionId]
            delete queuedMessagesBySession[sessionId]
            delete queueingEnabledBySession[sessionId]
            delete optimisticSteerMessagesBySession[sessionId]
            return {
                imageAttachmentsBySession,
                jsonArtifactUploadingBySession,
                queuedMessagesBySession,
                queueingEnabledBySession,
                optimisticSteerMessagesBySession,
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
        clearDraftSave(sessionId)
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
                imageAttachmentsBySession: {
                    ...state.imageAttachmentsBySession,
                    [sessionId]: [],
                },
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
                                    draftAttachments: [],
                                    draftArtifacts: [],
                                    messages: [
                                        ...session.messages,
                                        {
                                            id: createId('codex_user'),
                                            role: 'user',
                                            content,
                                            attachments: options?.attachments,
                                            jsonArtifacts: options?.artifactFiles,
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
            artifactFiles: options?.artifactFiles,
            onEvent: (event) => {
                const detail = applyCodexStreamEvent(set, novelKey, sessionId, event)
                if (detail) streamError = detail
            },
        })
        if (streamError) throw new Error(streamError)
    },
    compact: async (novelId, sessionId) => {
        const novelKey = getNovelKey(novelId)
        const pendingPatch = clearDraftSave(sessionId)
        if (pendingPatch?.draftAttachments || pendingPatch?.draftArtifacts) {
            await codexSessionApi.update(sessionId, {
                ...(pendingPatch.draftAttachments ? { draftAttachments: pendingPatch.draftAttachments } : {}),
                ...(pendingPatch.draftArtifacts ? { draftArtifacts: pendingPatch.draftArtifacts } : {}),
            })
        }
        // Optimistically flip to running so the composer shows the working (stop) state and clears
        // the `/compact` draft immediately, before the first stream event lands.
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId
                                ? { ...session, status: 'running', draftContent: '' }
                                : session
                        ),
                    },
                },
            }
        })

        let streamError: string | null = null
        await codexSessionApi.streamCompaction(sessionId, {
            onEvent: (event) => {
                const detail = applyCodexStreamEvent(set, novelKey, sessionId, event)
                if (detail) streamError = detail
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
