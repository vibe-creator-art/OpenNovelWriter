'use client'

import { useCodexWorkDetailsStore } from '@/components/editor/codex-work-details-store'

import { create, type StoreApi } from 'zustand'
import type { CodexUserInputRequest, CodexUserInputResponse } from '@/lib/codex-user-input'
import {
    ApiError,
    codexApi,
    codexSessionApi,
    novelApi,
    type CodexApprovalOption,
    type CodexApprovalRequest,
    type CodexRunEvent,
    type CodexSessionStreamEvent,
    type CodexReasoningEffort,
    type CodexReviewLevel,
    type CodexServiceTier,
    type CodexSession,
    type CodexSessionSummary,
    type CodexSessionCategory,
    type CodexSessionCleanupResult,
    type CodexComposerMode,
    type CodexContextWindow,
    type CodexPromptArtifact,
    type CodexDraftArtifact,
    type CodexRateLimits,
} from '@/lib/api'
import { getLatestContextWindowFromMessages } from '@/lib/codex-context-window'
import { mergeCodexRateLimits } from '@/lib/codex-rate-limits'
import { getNewCodexSessionModelSettings } from '@/lib/codex-config'
import {
    getStickyCodexFastMode,
    resolvePreferredCodexServiceTier,
} from '@/lib/codex-fast-mode-preference'
import type { PendingImageAttachment } from '@/components/image/use-image-attachments'
import { dispatchNovelRefreshRequested } from '@/lib/novel-refresh-events'
import { emitSceneEditsChanged } from '@/components/editor/scene-edit-events'
import { emitContinuationPanelRemoved } from '@/lib/continuation-panel-events'
import { mergeRefreshedSession, mergeServerSession, mergeSessionSummary } from '@/components/editor/codex-session-merge'
import {
    completionReadAtOnDraftChange,
    completionReadAtOnInteraction,
} from '@/components/editor/codex-completion-read'
import type { CodexResponseAnnotation } from '@/lib/codex-response-annotations'

export const EDITOR_CODEX_FALLBACK_NOVEL_ID = '__default__'

const STICKY_REVIEW_LEVEL_KEY = 'codex.reviewLevel'
const DEFAULT_REVIEW_LEVEL: CodexReviewLevel = 'user_review'

function isReviewLevel(value: string | null): value is CodexReviewLevel {
    return value === 'user_review' || value === 'auto_review' || value === 'no_review' || value === 'full_access'
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

async function getPreferredServiceTierForNewSession(novelId: string, category: CodexSessionCategory = 'general'): Promise<CodexServiceTier> {
    if (!getStickyCodexFastMode()) return 'standard'

    try {
        const connections = await codexApi.listConnections()
        const activeConnection = connections.find((connection) => connection.isActive) ?? null
        if (!activeConnection) return 'standard'

        const [{ models }, novel] = await Promise.all([
            codexApi.listConnectionModels(activeConnection.id),
            activeConnection.providerType === 'custom' ? novelApi.get(novelId) : null,
        ])
        return resolvePreferredCodexServiceTier({
            enabled: true,
            connection: activeConnection,
            customFastModeEnabled: novel?.codexCustomFastModeEnabled === true,
            models,
            modelId: getNewCodexSessionModelSettings(activeConnection, category).modelId,
        })
    } catch {
        return 'standard'
    }
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
    responseAnnotations: CodexResponseAnnotation[]
    createdAt: string
}

export class CodexSendError extends Error {
    constructor(error: unknown, readonly accepted: boolean) {
        super(error instanceof Error ? error.message : String(error), { cause: error })
        this.name = 'CodexSendError'
    }
}

type DraftSessionPatch = Partial<Pick<CodexSession, 'draftContent' | 'draftAttachments' | 'draftArtifacts'>>

type CodexStoreState = {
    sessionsByNovel: Record<string, CodexNovelSessionState>
    historyRequestsBySession: Record<string, { loading: boolean; error: string | null }>
    loadSession: (novelId: string | null | undefined, sessionId: string, options?: { force?: boolean }) => Promise<void>
    pendingApprovalsBySession: Record<string, CodexApprovalRequest | null>
    userInputRequestsBySession: Record<string, CodexUserInputRequest[]>
    refreshUserInputRequests: (sessionId: string) => Promise<void>
    answerUserInput: (sessionId: string, requestId: string, response: CodexUserInputResponse) => Promise<void>
    imageAttachmentsBySession: Record<string, PendingImageAttachment[]>
    jsonArtifactUploadingBySession: Record<string, boolean>
    queuedMessagesBySession: Record<string, QueuedCodexMessage[]>
    queueingEnabledBySession: Record<string, boolean>
    queuePausedBySession: Record<string, boolean>
    optimisticSteerMessagesBySession: Record<string, CodexSession['messages']>
    liveContextWindowBySession: Record<string, CodexContextWindow>
    liveRateLimitsByConnection: Record<string, CodexRateLimits>
    setLiveRateLimits: (
        connectionId: string,
        rateLimits: CodexRateLimits | null,
        mode?: 'replace' | 'merge' | 'hydrate'
    ) => void
    loadSessions: (novelId?: string | null, options?: { force?: boolean }) => Promise<void>
    /** Drop cached sessions so the next loadSessions hits the server again. */
    invalidateSessions: (novelId?: string | null) => void
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
    markSessionRead: (novelId: string | null | undefined, sessionId: string) => void
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
    setQueuePaused: (sessionId: string, paused: boolean) => void
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
    updateComposerMode: (novelId: string | null | undefined, sessionId: string, composerMode: CodexComposerMode) => Promise<void>
    controlGoal: (
        novelId: string | null | undefined,
        sessionId: string,
        action: { action: 'edit'; objective: string } | { action: 'pause' } | { action: 'clear' }
    ) => Promise<void>
    resumeGoal: (novelId: string | null | undefined, sessionId: string) => Promise<void>
    renameSession: (novelId: string | null | undefined, sessionId: string, title: string) => Promise<void>
    deleteSession: (novelId: string | null | undefined, sessionId: string) => Promise<void>
    removeDeletedSession: (novelId: string | null | undefined, sessionId: string) => void
    stop: (novelId: string | null | undefined, sessionId: string) => Promise<void>
    sendMessage: (
        novelId: string | null | undefined,
        sessionId: string,
        content: string,
        options?: {
            preserveComposer?: boolean
            skillIds?: string[]
            promptArtifact?: CodexPromptArtifact
            attachments?: string[]
            artifactFiles?: string[]
            responseAnnotations?: CodexResponseAnnotation[]
        }
    ) => Promise<void>
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
const historyLoadPromises = new Map<string, Promise<void>>()
const sessionCreatePromises = new Map<string, Promise<string | null>>()
const deletedSessionIds = new Set<string>()
const deletingSessionIds = new Set<string>()
const activeRunControllers = new Map<string, AbortController>()
const userInputRevisions = new Map<string, number>()

function bumpUserInputRevision(sessionId: string) {
    userInputRevisions.set(sessionId, (userInputRevisions.get(sessionId) ?? 0) + 1)
}

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

function removeSessionFromState(state: CodexStoreState, novelKey: string, sessionId: string) {
    useCodexWorkDetailsStore.getState().clear(sessionId)
    const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
    const sessions = current.sessions.filter((session) => session.id !== sessionId)
    const historyRequestsBySession = { ...state.historyRequestsBySession }
    delete historyRequestsBySession[sessionId]
    const pendingApprovalsBySession = { ...state.pendingApprovalsBySession }
    const userInputRequestsBySession = { ...state.userInputRequestsBySession }
    const imageAttachmentsBySession = { ...state.imageAttachmentsBySession }
    const jsonArtifactUploadingBySession = { ...state.jsonArtifactUploadingBySession }
    const queuedMessagesBySession = { ...state.queuedMessagesBySession }
    const queueingEnabledBySession = { ...state.queueingEnabledBySession }
    const queuePausedBySession = { ...state.queuePausedBySession }
    const optimisticSteerMessagesBySession = { ...state.optimisticSteerMessagesBySession }
    const liveContextWindowBySession = { ...state.liveContextWindowBySession }
    delete pendingApprovalsBySession[sessionId]
    delete userInputRequestsBySession[sessionId]
    bumpUserInputRevision(sessionId)
    delete imageAttachmentsBySession[sessionId]
    delete jsonArtifactUploadingBySession[sessionId]
    delete queuedMessagesBySession[sessionId]
    delete queueingEnabledBySession[sessionId]
    delete queuePausedBySession[sessionId]
    delete optimisticSteerMessagesBySession[sessionId]
    delete liveContextWindowBySession[sessionId]
    return {
        historyRequestsBySession,
        pendingApprovalsBySession,
        userInputRequestsBySession,
        imageAttachmentsBySession,
        jsonArtifactUploadingBySession,
        queuedMessagesBySession,
        queueingEnabledBySession,
        queuePausedBySession,
        optimisticSteerMessagesBySession,
        liveContextWindowBySession,
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
}

function beginClientRun(sessionId: string) {
    if (deletingSessionIds.has(sessionId) || deletedSessionIds.has(sessionId)) {
        throw new Error('Codex session is being deleted.')
    }
    if (activeRunControllers.has(sessionId)) return null
    const controller = new AbortController()
    activeRunControllers.set(sessionId, controller)
    return controller
}

function finishClientRun(sessionId: string, controller: AbortController) {
    if (activeRunControllers.get(sessionId) === controller) {
        activeRunControllers.delete(sessionId)
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
    if (deletedSessionIds.has(session.id)) return state
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
    cleanup.deletedSessionIds.forEach((id) => {
        clearDraftSave(id)
        useCodexWorkDetailsStore.getState().clear(id)
    })
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

function mergeSessionPreservingComposer(
    current: CodexNovelSessionState,
    session: CodexSession,
    options?: { preserveRunning?: boolean }
) {
    const local = current.sessions.find((item) => item.id === session.id)
    return mergeServerSession(local, session, options)
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
        workStatus: event.workStatus,
        toolInput: event.toolInput,
        detailVersion: event.detailVersion,
        sceneEdit: event.sceneEdit,
        content: [event.title, event.content].filter(Boolean).join('\n\n'),
        attachments: event.attachments,
        responseAnnotations: event.responseAnnotations,
        createdAt: event.createdAt,
    }
}

function upsertMessage(session: CodexSession, message: CodexSession['messages'][number]) {
    const exists = session.messages.some((item) => item.id === message.id)
    return {
        ...session,
        messageCount: exists ? session.messages.length : session.messages.length + 1,
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

function persistCompletionRead(sessionId: string, completedAt: string) {
    void codexSessionApi.markCompletionRead(sessionId, completedAt).catch((error) => {
        console.error('Failed to mark Codex completion as read:', error)
    })
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
    if (deletedSessionIds.has(sessionId)) return null

    if (event.type === 'done') {
        bumpUserInputRevision(sessionId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const session = mergeSessionPreservingComposer(current, event.session, { preserveRunning: false })
            const liveContextWindowBySession = { ...state.liveContextWindowBySession }
            if (getLatestContextWindowFromMessages(session.messages)) {
                delete liveContextWindowBySession[sessionId]
            }
            return {
                userInputRequestsBySession: { ...state.userInputRequestsBySession, [sessionId]: [] },
                pendingApprovalsBySession: {
                    ...state.pendingApprovalsBySession,
                    [sessionId]: null,
                },
                liveContextWindowBySession,
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(current, session),
                },
            }
        })
        return null
    }

    if (event.type === 'error') {
        bumpUserInputRevision(sessionId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const session = event.session
                ? mergeSessionPreservingComposer(current, event.session, { preserveRunning: false })
                : null
            return {
                userInputRequestsBySession: { ...state.userInputRequestsBySession, [sessionId]: [] },
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

    if (event.type === 'rate_limits') {
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            const connectionId = event.connectionId
                ?? current.sessions.find((session) => session.id === sessionId)?.codexConnectionId
                ?? null
            if (!connectionId) return state
            const merged = mergeCodexRateLimits(
                state.liveRateLimitsByConnection[connectionId] ?? null,
                event.rateLimits
            )
            if (!merged) return state
            return {
                liveRateLimitsByConnection: {
                    ...state.liveRateLimitsByConnection,
                    [connectionId]: merged,
                },
            }
        })
        return null
    }

    if (event.type === 'user_input_request' || event.type === 'user_input_resolved') {
        bumpUserInputRevision(sessionId)
        set((state) => {
            const requests = state.userInputRequestsBySession[sessionId] ?? []
            const id = event.type === 'user_input_request' ? event.request.id : event.id
            return { userInputRequestsBySession: {
                ...state.userInputRequestsBySession,
                [sessionId]: event.type === 'user_input_request'
                    ? [...requests.filter((request) => request.id !== id), event.request]
                    : requests.filter((request) => request.id !== id),
            } }
        })
        return null
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

    if (event.type === 'goal_updated' || event.type === 'goal_cleared') {
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId
                                ? event.type === 'goal_updated'
                                    ? { ...session, composerMode: 'goal', goal: event.goal }
                                    : { ...session, composerMode: 'default', goal: null }
                                : session
                        ),
                    },
                },
            }
        })
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
                        if (event.type === 'reasoning_delta') {
                            const existing = session.messages.find((message) => message.id === event.id)
                            return upsertMessage(session, {
                                id: event.id, role: 'event', kind: 'reasoning', workStatus: 'running',
                                content: `${existing?.content ?? ''}${event.delta}`, createdAt: existing?.createdAt ?? event.createdAt,
                            })
                        }
                        if (event.type === 'plan_delta') return appendPlanDelta(session, event)
                        if (event.type === 'context_window') return attachContextWindow(session, event)
                        return upsertMessage(session, eventToMessage(event.event))
                    }),
                },
            },
            liveContextWindowBySession: event.type === 'context_window'
                ? { ...state.liveContextWindowBySession, [sessionId]: event.contextWindow }
                : state.liveContextWindowBySession,
        }
    })
    return null
}

export const useEditorCodexStore = create<CodexStoreState>()((set, get) => ({
    sessionsByNovel: {},
    historyRequestsBySession: {},
    pendingApprovalsBySession: {},
    userInputRequestsBySession: {},
    refreshUserInputRequests: async (sessionId) => {
        const revision = userInputRevisions.get(sessionId) ?? 0
        const { requests } = await codexSessionApi.listUserInputRequests(sessionId)
        if ((userInputRevisions.get(sessionId) ?? 0) !== revision || deletedSessionIds.has(sessionId)) return
        set((state) => ({ userInputRequestsBySession: { ...state.userInputRequestsBySession, [sessionId]: requests } }))
    },
    answerUserInput: async (sessionId, requestId, response) => {
        await codexSessionApi.answerUserInput(sessionId, requestId, response)
        bumpUserInputRevision(sessionId)
        set((state) => ({ userInputRequestsBySession: {
            ...state.userInputRequestsBySession,
            [sessionId]: (state.userInputRequestsBySession[sessionId] ?? []).filter((request) => request.id !== requestId),
        } }))
    },
    imageAttachmentsBySession: {},
    jsonArtifactUploadingBySession: {},
    queuedMessagesBySession: {},
    queueingEnabledBySession: {},
    queuePausedBySession: {},
    optimisticSteerMessagesBySession: {},
    liveContextWindowBySession: {},
    liveRateLimitsByConnection: {},
    setLiveRateLimits: (connectionId, rateLimits, mode = 'replace') => {
        set((state) => {
            const existing = state.liveRateLimitsByConnection[connectionId] ?? null
            if (!rateLimits && mode === 'replace') {
                if (!existing) return state
                const liveRateLimitsByConnection = { ...state.liveRateLimitsByConnection }
                delete liveRateLimitsByConnection[connectionId]
                return { liveRateLimitsByConnection }
            }
            const nextValue = mode === 'merge'
                ? mergeCodexRateLimits(existing, rateLimits)
                : mode === 'hydrate'
                    ? mergeCodexRateLimits(rateLimits, existing)
                    : rateLimits
            if (!nextValue) return state
            return {
                liveRateLimitsByConnection: {
                    ...state.liveRateLimitsByConnection,
                    [connectionId]: nextValue,
                },
            }
        })
    },
    invalidateSessions: (novelId) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID) {
            set({ sessionsByNovel: {} })
            return
        }
        set((state) => {
            const current = state.sessionsByNovel[novelKey]
            if (!current) return state
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: { ...current, loaded: false },
                },
            }
        })
    },
    loadSessions: async (novelId, options) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID) return
        if (!options?.force && get().sessionsByNovel[novelKey]?.loaded) return
        const pendingLoad = sessionLoadPromises.get(novelKey)
        if (pendingLoad) return pendingLoad

        const sessionsAtStart = new Map(
            (get().sessionsByNovel[novelKey]?.sessions ?? []).map((session) => [session.id, session])
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
                const recoveredRuns = new Map<string, AbortController>()
                set((state) => {
                    const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                    const currentById = new Map(current.sessions.map((session) => [session.id, session]))
                    const serverSessions = result.sessions.filter((session) => !deletedSessionIds.has(session.id))
                    const serverIds = new Set(serverSessions.map((session) => session.id))
                    const sessions = sortSessions([
                        ...serverSessions.map((session) => mergeSessionSummary(
                            currentById.get(session.id),
                            session,
                            sessionsAtStart.get(session.id),
                            activeRunControllers.has(session.id)
                        )),
                        ...current.sessions.filter(
                            (session) => !serverIds.has(session.id) && !sessionsAtStart.has(session.id)
                        ),
                    ])
                    const selectedSessionId =
                        current.selectedSessionId && sessions.some((session) => session.id === current.selectedSessionId)
                            ? current.selectedSessionId
                            : sessions[0]?.id ?? null
                    const pendingApprovalsBySession = { ...state.pendingApprovalsBySession }
                    const userInputRequestsBySession = { ...state.userInputRequestsBySession }
                    sessions.forEach((session) => {
                        if (session.status === 'running') return
                        pendingApprovalsBySession[session.id] = null
                        userInputRequestsBySession[session.id] = []
                        bumpUserInputRevision(session.id)
                        const controller = activeRunControllers.get(session.id)
                        if (controller) recoveredRuns.set(session.id, controller)
                    })
                    const imageAttachmentsBySession = { ...state.imageAttachmentsBySession }
                    sessions.forEach((session) => {
                        if (!Object.hasOwn(imageAttachmentsBySession, session.id)) {
                            imageAttachmentsBySession[session.id] = restoreDraftImageAttachments(session)
                        }
                    })
                    return {
                        pendingApprovalsBySession,
                        userInputRequestsBySession,
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
                recoveredRuns.forEach((controller, sessionId) => {
                    finishClientRun(sessionId, controller)
                    controller.abort()
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
    loadSession: async (novelId, sessionId, options) => {
        const novelKey = getNovelKey(novelId)
        const atStart = get().sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)
        if (!atStart || activeRunControllers.has(sessionId) || (!options?.force && atStart.historyLoaded)) return
        const pending = historyLoadPromises.get(sessionId)
        if (pending) return pending
        const request = (async () => {
            set((state) => ({ historyRequestsBySession: {
                ...state.historyRequestsBySession, [sessionId]: { loading: true, error: null },
            } }))
            try {
                const { session } = await codexSessionApi.get(sessionId)
                set((state) => {
                    const current = state.sessionsByNovel[novelKey]
                    const local = current?.sessions.find((item) => item.id === sessionId)
                    if (!current || !local || deletedSessionIds.has(sessionId)) return state
                    return {
                        sessionsByNovel: { ...state.sessionsByNovel, [novelKey]: applySession(
                            current,
                            mergeRefreshedSession(local, session, atStart, activeRunControllers.has(sessionId)),
                            { front: false }
                        ) },
                        historyRequestsBySession: { ...state.historyRequestsBySession, [sessionId]: { loading: false, error: null } },
                    }
                })
            } catch (error) {
                if (deletedSessionIds.has(sessionId)) return
                set((state) => ({ historyRequestsBySession: {
                    ...state.historyRequestsBySession,
                    [sessionId]: { loading: false, error: error instanceof Error ? error.message : String(error) },
                } }))
            }
        })()
        historyLoadPromises.set(sessionId, request)
        try { await request } finally { historyLoadPromises.delete(sessionId) }
    },
    createSession: async (novelId) => {
        const novelKey = getNovelKey(novelId)
        if (novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID) return null
        const pendingCreate = sessionCreatePromises.get(novelKey)
        if (pendingCreate) return pendingCreate

        const createPromise = (async () => {
            await get().loadSessions(novelKey)
            const serviceTier = await getPreferredServiceTierForNewSession(novelKey)
            const reusableDraft = get().sessionsByNovel[novelKey]?.sessions.find(
                (session) => session.category === 'general' && session.messageCount === 0
            )
            if (reusableDraft) {
                if (reusableDraft.serviceTier !== serviceTier) {
                    await get().updateModelSettings(novelKey, reusableDraft.id, { serviceTier })
                }
                get().selectSession(novelKey, reusableDraft.id)
                return reusableDraft.id
            }

            const result = await codexSessionApi.create(novelKey, {
                category: 'general',
                reviewLevel: getStickyReviewLevel(),
                serviceTier,
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
        const serviceTier = await getPreferredServiceTierForNewSession(novelKey, 'scene_operation')

        const result = await codexSessionApi.create(novelKey, {
            category: 'scene_operation',
            skillId: input.skillId,
            sceneId: input.sceneId,
            title: input.title ?? null,
            titleManuallyEdited: Boolean(input.title),
            reviewLevel: getStickyReviewLevel(),
            serviceTier,
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
        const serviceTier = await getPreferredServiceTierForNewSession(novelKey)

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
            serviceTier,
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
                    [novelKey]: {
                        ...current,
                        selectedSessionId: sessionId,
                    },
                },
            }
        })
        get().markSessionRead(novelId, sessionId)
    },
    markSessionRead: (novelId, sessionId) => {
        const novelKey = getNovelKey(novelId)
        const completedAt = completionReadAtOnInteraction(
            get().sessionsByNovel[novelKey] ?? getEmptySession(),
            sessionId
        )
        if (!completedAt) return
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId ? { ...session, unreadCompletionAt: null } : session
                        ),
                    },
                },
            }
        })
        persistCompletionRead(sessionId, completedAt)
    },
    updateDraft: (novelId, sessionId, draftContent) => {
        const novelKey = getNovelKey(novelId)
        const completedAt = completionReadAtOnDraftChange(
            get().sessionsByNovel[novelKey] ?? getEmptySession(),
            sessionId,
            draftContent
        )
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId
                                ? {
                                    ...session,
                                    draftContent,
                                }
                                : session
                        ),
                    },
                },
            }
        })
        if (completedAt) get().markSessionRead(novelId, sessionId)
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
    setQueuePaused: (sessionId, paused) => {
        set((state) => ({
            queuePausedBySession: { ...state.queuePausedBySession, [sessionId]: paused },
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
    updateComposerMode: async (novelId, sessionId, composerMode) => {
        const novelKey = getNovelKey(novelId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: {
                        ...current,
                        sessions: current.sessions.map((session) =>
                            session.id === sessionId ? { ...session, composerMode } : session
                        ),
                    },
                },
            }
        })

        const result = await codexSessionApi.update(sessionId, { composerMode })
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
    controlGoal: async (novelId, sessionId, action) => {
        const novelKey = getNovelKey(novelId)
        const result = await codexSessionApi.controlGoal(sessionId, action)
        const preserveRunning = action.action === 'edit'
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(
                        current,
                        mergeSessionPreservingComposer(current, result.session, { preserveRunning }),
                        { front: false }
                    ),
                },
            }
        })
    },
    resumeGoal: async (novelId, sessionId) => {
        const novelKey = getNovelKey(novelId)
        if (!get().sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)?.historyLoaded) {
            await get().loadSession(novelKey, sessionId)
            if (!get().sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)?.historyLoaded) {
                throw new Error(get().historyRequestsBySession[sessionId]?.error || 'Could not load Codex session.')
            }
        }
        const controller = beginClientRun(sessionId)
        if (!controller) return
        try {
            set((state) => {
                const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                return {
                    sessionsByNovel: {
                        ...state.sessionsByNovel,
                        [novelKey]: {
                            ...current,
                            sessions: current.sessions.map((session) =>
                                session.id === sessionId
                                    ? { ...session, status: 'running', unreadCompletionAt: null }
                                    : session
                            ),
                        },
                    },
                }
            })
            let streamError: string | null = null
            await codexSessionApi.streamGoalResume(sessionId, {
                signal: controller.signal,
                onEvent: (event) => {
                    if (activeRunControllers.get(sessionId) !== controller) return
                    if (event.type === 'done' || event.type === 'error') finishClientRun(sessionId, controller)
                    const detail = applyCodexStreamEvent(set, novelKey, sessionId, event)
                    if (detail) streamError = detail
                },
            })
            if (streamError) throw new Error(streamError)
        } catch (error) {
            if (controller.signal.aborted) return
            throw error
        } finally {
            finishClientRun(sessionId, controller)
        }
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
        if (deletingSessionIds.has(sessionId) || deletedSessionIds.has(sessionId)) return
        const novelKey = getNovelKey(novelId)
        deletingSessionIds.add(sessionId)
        const pendingDraftPatch = clearDraftSave(sessionId)

        try {
            if (novelKey !== EDITOR_CODEX_FALLBACK_NOVEL_ID) {
                const result = await codexSessionApi.delete(sessionId)
                // A scene-continuation session is paired with an inline panel; the server removed it
                // from the stored scene HTML, so drop the live node too if that scene is open.
                if (result.removedPanelId) emitContinuationPanelRemoved(result.removedPanelId)
            }
            deletedSessionIds.add(sessionId)
            set((state) => removeSessionFromState(state, novelKey, sessionId))
        } catch (error) {
            let serverSession: CodexSessionSummary | null = null
            let sessionListLoaded = false
            if (novelKey !== EDITOR_CODEX_FALLBACK_NOVEL_ID) {
                try {
                    const result = await codexSessionApi.list(novelKey)
                    sessionListLoaded = true
                    serverSession = result.sessions.find((session) => session.id === sessionId) ?? null
                } catch {
                    sessionListLoaded = false
                }
            }

            if (sessionListLoaded && !serverSession) {
                deletedSessionIds.add(sessionId)
                set((state) => removeSessionFromState(state, novelKey, sessionId))
                emitSceneEditsChanged(novelKey)
                return
            }

            if (pendingDraftPatch) scheduleDraftSave(sessionId, pendingDraftPatch)
            if (serverSession) {
                set((state) => {
                    const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                    return {
                        sessionsByNovel: {
                            ...state.sessionsByNovel,
                            [novelKey]: applySession(
                                current,
                                mergeSessionSummary(current.sessions.find((item) => item.id === sessionId), serverSession, current.sessions.find((item) => item.id === sessionId), activeRunControllers.has(sessionId)),
                                { front: false }
                            ),
                        },
                    }
                })
            }
            throw error
        } finally {
            deletingSessionIds.delete(sessionId)
        }

        // The server finalized this session's pending manuscript edits; refresh the review UI.
        emitSceneEditsChanged(novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID ? undefined : novelKey)
    },
    removeDeletedSession: (novelId, sessionId) => {
        const novelKey = getNovelKey(novelId)
        deletingSessionIds.delete(sessionId)
        deletedSessionIds.add(sessionId)
        clearDraftSave(sessionId)
        set((state) => removeSessionFromState(state, novelKey, sessionId))
        emitSceneEditsChanged(novelKey === EDITOR_CODEX_FALLBACK_NOVEL_ID ? undefined : novelKey)
    },
    stop: async (novelId, sessionId) => {
        const novelKey = getNovelKey(novelId)
        activeRunControllers.get(sessionId)?.abort()
        const result = await codexSessionApi.stop(sessionId)
        set((state) => {
            const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
            return {
                sessionsByNovel: {
                    ...state.sessionsByNovel,
                    [novelKey]: applySession(
                        current,
                        mergeSessionPreservingComposer(current, result.session, { preserveRunning: false }),
                        { front: false }
                    ),
                },
            }
        })
    },
    sendMessage: async (novelId, sessionId, content, options) => {
        const novelKey = getNovelKey(novelId)
        if (!get().sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)?.historyLoaded) {
            await get().loadSession(novelKey, sessionId)
            if (!get().sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)?.historyLoaded) {
                throw new Error(get().historyRequestsBySession[sessionId]?.error || 'Could not load Codex session.')
            }
        }
        const originalSession = get().sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)
        if (!originalSession) return
        const originalImages = get().imageAttachmentsBySession[sessionId] ?? []
        const controller = beginClientRun(sessionId)
        if (!controller) return
        const messageId = createId('codex_user')
        let receivedEvent = false
        let composerChanged = false
        let unsubscribeComposer: (() => void) | undefined
        try {
            clearDraftSave(sessionId)
            set((state) => {
                const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                const now = new Date().toISOString()
                return {
                    imageAttachmentsBySession: {
                        ...state.imageAttachmentsBySession,
                        [sessionId]: options?.preserveComposer ? originalImages : [],
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
                                        unreadCompletionAt: null,
                                        draftContent: options?.preserveComposer ? session.draftContent : '',
                                        draftAttachments: options?.preserveComposer ? session.draftAttachments : [],
                                        draftArtifacts: options?.preserveComposer ? session.draftArtifacts : [],
                                        messageCount: session.messages.length + 1,
                                        messages: [
                                            ...session.messages,
                                            {
                                                id: messageId,
                                                role: 'user',
                                                content,
                                                attachments: options?.attachments,
                                                jsonArtifacts: options?.artifactFiles,
                                                responseAnnotations: options?.responseAnnotations,
                                                ...(session.composerMode === 'goal' && !session.goal ? { sentAsGoal: true } : {}),
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

            unsubscribeComposer = useEditorCodexStore.subscribe((state, previous) => {
                const before = previous.sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)
                const after = state.sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)
                if (before?.draftContent !== after?.draftContent
                    || before?.draftAttachments !== after?.draftAttachments
                    || before?.draftArtifacts !== after?.draftArtifacts
                    || previous.imageAttachmentsBySession[sessionId] !== state.imageAttachmentsBySession[sessionId]) {
                    composerChanged = true
                }
            })

            let streamError: string | null = null
            await codexSessionApi.streamMessage(sessionId, content, {
                messageId,
                signal: controller.signal,
                skillIds: options?.skillIds,
                promptArtifact: options?.promptArtifact,
                attachments: options?.attachments,
                artifactFiles: options?.artifactFiles,
                responseAnnotations: options?.responseAnnotations,
                onEvent: (event) => {
                    if (activeRunControllers.get(sessionId) !== controller) return
                    receivedEvent = true
                    if (event.type === 'done' || event.type === 'error') {
                        finishClientRun(sessionId, controller)
                    }
                    const detail = applyCodexStreamEvent(set, novelKey, sessionId, event)
                    if (detail) streamError = detail
                },
            })
            if (streamError) throw new Error(streamError)
        } catch (error) {
            if (controller.signal.aborted) return
            let accepted = receivedEvent
            if (!receivedEvent && !deletedSessionIds.has(sessionId)) {
                const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500
                let serverSession: CodexSession | undefined
                let fetchedSessions = false
                try {
                    const result = await codexSessionApi.get(sessionId)
                    serverSession = result.session
                    fetchedSessions = true
                } catch (recoveryError) {
                    if (recoveryError instanceof ApiError && recoveryError.status === 404) fetchedSessions = true
                    // Keep the submitted inputs available when the server cannot be reached.
                }
                if (controller.signal.aborted || deletedSessionIds.has(sessionId)) return
                accepted = !rejected && (serverSession?.messages.some((message) => message.id === messageId) ?? false)
                unsubscribeComposer?.()
                if (fetchedSessions && !serverSession) {
                    set((state) => removeSessionFromState(state, novelKey, sessionId))
                } else {
                    const restoreComposer = !accepted && !composerChanged
                    set((state) => {
                        const current = state.sessionsByNovel[novelKey] ?? getEmptySession()
                        return {
                            ...(restoreComposer ? {
                                imageAttachmentsBySession: { ...state.imageAttachmentsBySession, [sessionId]: originalImages },
                            } : {}),
                            sessionsByNovel: {
                                ...state.sessionsByNovel,
                                [novelKey]: {
                                    ...current,
                                    sessions: current.sessions.map((session) => session.id !== sessionId ? session : {
                                        ...session,
                                        ...(serverSession ?? {
                                            status: rejected ? originalSession.status : 'error' as const,
                                            messages: session.messages.filter((message) => message.id !== messageId),
                                            lastError: error instanceof Error ? error.message : String(error),
                                        }),
                                        draftContent: restoreComposer ? originalSession.draftContent : session.draftContent,
                                        draftAttachments: restoreComposer ? originalSession.draftAttachments : session.draftAttachments,
                                        draftArtifacts: restoreComposer ? originalSession.draftArtifacts : session.draftArtifacts,
                                    }),
                                },
                            },
                        }
                    })
                    if (restoreComposer) scheduleDraftSave(sessionId, {
                        draftContent: originalSession.draftContent,
                        draftAttachments: originalSession.draftAttachments,
                        draftArtifacts: originalSession.draftArtifacts,
                    })
                }
            }
            throw new CodexSendError(error, accepted)
        } finally {
            unsubscribeComposer?.()
            if (options?.preserveComposer && !deletedSessionIds.has(sessionId)) {
                const session = get().sessionsByNovel[novelKey]?.sessions.find((item) => item.id === sessionId)
                if (session) scheduleDraftSave(sessionId, {
                    draftContent: session.draftContent,
                    draftAttachments: session.draftAttachments,
                    draftArtifacts: session.draftArtifacts,
                })
            }
            finishClientRun(sessionId, controller)
        }
    },
    compact: async (novelId, sessionId) => {
        const novelKey = getNovelKey(novelId)
        if (!get().sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)?.historyLoaded) {
            await get().loadSession(novelKey, sessionId)
            if (!get().sessionsByNovel[novelKey]?.sessions.find((session) => session.id === sessionId)?.historyLoaded) {
                throw new Error(get().historyRequestsBySession[sessionId]?.error || 'Could not load Codex session.')
            }
        }
        const controller = beginClientRun(sessionId)
        if (!controller) return
        try {
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
                                    ? { ...session, status: 'running', unreadCompletionAt: null, draftContent: '' }
                                    : session
                            ),
                        },
                    },
                }
            })

            let streamError: string | null = null
            await codexSessionApi.streamCompaction(sessionId, {
                signal: controller.signal,
                onEvent: (event) => {
                    if (activeRunControllers.get(sessionId) !== controller) return
                    if (event.type === 'done' || event.type === 'error') {
                        finishClientRun(sessionId, controller)
                    }
                    const detail = applyCodexStreamEvent(set, novelKey, sessionId, event)
                    if (detail) streamError = detail
                },
            })
            if (streamError) throw new Error(streamError)
        } catch (error) {
            if (controller.signal.aborted) return
            throw error
        } finally {
            finishClientRun(sessionId, controller)
        }
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
