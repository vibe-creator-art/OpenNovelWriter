import type { ModelAssignment, ModelGroup } from '@/lib/ai-store'
import { aiApi, ApiError } from '@/lib/api'
import {
    computeFailureUpdates,
    getResetAssignmentHealth,
    normalizeFailurePolicy,
} from '@/lib/ai-group-config'
import { useAiRuntimeStore } from '@/lib/ai-runtime-store'
import { useAiRunUiStore } from '@/lib/ai-run-ui-store'
import { useAuthStore } from '@/lib/store'

export type RunChatMessage = {
    role: 'system' | 'user' | 'assistant'
    content: string
    /** Managed image URLs attached to a user message; the server inlines the bytes. */
    images?: string[]
}

type RunModelInput = {
    stream?: boolean
    system?: string
    temperature?: number
    maxTokens?: number
    messages?: RunChatMessage[]
    prompt?: string
}

export type ModelTokenUsage = {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
}

export function isAssignmentAvailable(assignment: Pick<ModelAssignment, 'manuallyDisabled' | 'ignoredUntil'>, nowMs = Date.now()) {
    if (assignment.manuallyDisabled) return false
    if (!assignment.ignoredUntil) return true
    const ignoredUntilMs = new Date(assignment.ignoredUntil).getTime()
    if (Number.isNaN(ignoredUntilMs)) return true
    return ignoredUntilMs <= nowMs
}

function isAbortError(error: unknown) {
    return (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError')
    )
}

function getEffectiveAssignments(group: ModelGroup): ModelAssignment[] {
    const overridesById = useAiRuntimeStore.getState().assignmentOverridesById
    return (group.assignments ?? []).map((assignment) => ({
        ...assignment,
        ...(overridesById[assignment.id] ?? {}),
    }))
}

export function getAvailableModelAssignments(group: ModelGroup, nowMs = Date.now()) {
    return getEffectiveAssignments(group).filter((assignment) => isAssignmentAvailable(assignment, nowMs))
}

async function runModelGroupStream(
    data: {
        groupId: string
        preferredAssignmentId?: string | null
        system?: string
        temperature?: number
        maxTokens?: number
        messages?: RunChatMessage[]
        prompt?: string
    },
    options?: {
        signal?: AbortSignal
        onTextDelta?: (delta: string) => Promise<void> | void
        onReasoningDelta?: (delta: string) => Promise<void> | void
    }
) {
    const token = useAuthStore.getState().token
    if (!token) {
        throw new ApiError(401, 'Not authenticated - no token available')
    }

    const response = await fetch('/api/ai/run-group', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
        signal: options?.signal,
    })

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Request failed' }))
        throw new ApiError(response.status, error.detail || 'Request failed', error)
    }

    const reader = response.body?.getReader()
    if (!reader) return { text: '', reasoningText: undefined }

    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let reasoningText = ''
    let usedAssignment: ModelAssignment | undefined
    let usage: ModelTokenUsage | undefined

    const consumeLine = async (line: string) => {
        const trimmed = line.trim()
        if (!trimmed) return
        const event = JSON.parse(trimmed) as
            | { type: 'text_delta'; delta: string }
            | { type: 'reasoning_delta'; delta: string }
            | { type: 'end'; text?: string; reasoningText?: string; usage?: ModelTokenUsage; usedAssignment?: ModelAssignment }
            | { type: 'error'; error?: { message?: string } }

        if (event.type === 'text_delta') {
            text += event.delta
            await options?.onTextDelta?.(event.delta)
            return
        }

        if (event.type === 'reasoning_delta') {
            reasoningText += event.delta
            await options?.onReasoningDelta?.(event.delta)
            return
        }

        if (event.type === 'end') {
            text = event.text ?? text
            reasoningText = event.reasoningText ?? reasoningText
            usage = event.usage
            usedAssignment = event.usedAssignment
            return
        }

        if (event.type === 'error') {
            throw new Error(event.error?.message || 'Failed to run model.')
        }
    }

    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                await consumeLine(line)
            }
        }

        const trailing = buffer + decoder.decode()
        if (trailing.trim()) {
            await consumeLine(trailing)
        }
    } finally {
        reader.releaseLock()
    }

    return { text, reasoningText: reasoningText.trim() ? reasoningText : undefined, usage, usedAssignment }
}

const RR_LAST_USED_PREFIX = 'onw.ai.round_robin.last_used.'

function safeGetLocalStorage(key: string): string | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetLocalStorage(key: string, value: string) {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(key, value)
    } catch {
        // Ignore unavailable storage.
    }
}

function getRoundRobinStartIndex(groupId: string, available: ModelAssignment[]) {
    if (available.length === 0) return 0
    const lastUsedId = safeGetLocalStorage(`${RR_LAST_USED_PREFIX}${groupId}`) ?? ''
    if (!lastUsedId) return 0
    const index = available.findIndex((assignment) => assignment.id === lastUsedId)
    if (index < 0) return 0
    return (index + 1) % available.length
}

function setRoundRobinLastUsed(groupId: string, assignmentId: string) {
    safeSetLocalStorage(`${RR_LAST_USED_PREFIX}${groupId}`, assignmentId)
}

function showFallbackToast(message: string) {
    useAiRunUiStore.getState().showToast(message, { durationMs: 10_000 })
}

function hideFallbackToast() {
    useAiRunUiStore.getState().hideToast()
}

function showFatalDialog(params: { title: string; description: string }) {
    useAiRunUiStore.getState().showFatal(params.title, params.description)
}

function formatAssignmentLabel(params: {
    assignment: ModelAssignment
    resolveConnectionName?: (connectionId: string) => string | null | undefined
}) {
    const name = params.resolveConnectionName?.(params.assignment.connectionId) ?? ''
    const prefix = name.trim() ? `${name.trim()} · ` : ''
    return `${prefix}${params.assignment.modelId}`
}

export async function runModelGroupWithFallback(options: {
    group: ModelGroup
    input: RunModelInput
    preferredAssignmentId?: string | null
    signal?: AbortSignal
    resolveConnectionName?: (connectionId: string) => string | null | undefined
    ui?: { enabled?: boolean }
    onTextDelta?: (delta: string) => Promise<void> | void
    onReasoningDelta?: (delta: string) => Promise<void> | void
}): Promise<{ text: string; reasoningText?: string; usage?: ModelTokenUsage; usedAssignment: ModelAssignment }> {
    const uiEnabled = options.ui?.enabled !== false
    const nowMs = Date.now()
    const available = getAvailableModelAssignments(options.group, nowMs)

    if (available.length === 0) {
        if (uiEnabled) {
            hideFallbackToast()
            showFatalDialog({
                title: '模型调用失败',
                description: `模型组「${options.group.name}」的所有 provider 全部不可用。请使用其他模型组，或在设置中手动启用已禁用的 provider。`,
            })
        }
        throw new Error('No available model assignment.')
    }

    const preferred = (options.preferredAssignmentId ?? '').trim()
    const strategy = options.group.settings?.strategy ?? 'priority'

    let startIndex = 0
    if (preferred) {
        const index = available.findIndex((assignment) => assignment.id === preferred)
        if (index >= 0) startIndex = index
        else if (strategy === 'round-robin') startIndex = getRoundRobinStartIndex(options.group.id, available)
    } else if (strategy === 'round-robin') {
        startIndex = getRoundRobinStartIndex(options.group.id, available)
    }

    const attemptOrder = [...available.slice(startIndex), ...available.slice(0, startIndex)]
    const failurePolicy = normalizeFailurePolicy(options.group.failurePolicy)
    let lastError: unknown = null

    if (options.input.stream === true) {
        try {
            const result = await runModelGroupStream(
                {
                    groupId: options.group.id,
                    preferredAssignmentId: attemptOrder[0]?.id ?? null,
                    system: options.input.system,
                    temperature: options.input.temperature,
                    maxTokens: options.input.maxTokens,
                    messages: options.input.messages,
                    prompt: options.input.prompt,
                },
                {
                    signal: options.signal,
                    onTextDelta: options.onTextDelta,
                    onReasoningDelta: options.onReasoningDelta,
                }
            )
            const usedAssignment = result.usedAssignment ?? attemptOrder[0]
            if (strategy === 'round-robin' && usedAssignment?.id) {
                setRoundRobinLastUsed(options.group.id, usedAssignment.id)
            }
            if (usedAssignment && (usedAssignment.failureCount !== 0 || usedAssignment.ignoredUntil)) {
                const updates = getResetAssignmentHealth()
                useAiRuntimeStore.getState().applyAssignmentOverride(usedAssignment.id, updates)
            }
            if (uiEnabled) hideFallbackToast()
            return { text: result.text, reasoningText: result.reasoningText, usage: result.usage, usedAssignment }
        } catch (error) {
            if (isAbortError(error)) {
                if (uiEnabled) hideFallbackToast()
                throw error
            }
            if (uiEnabled) {
                hideFallbackToast()
                showFatalDialog({
                    title: '模型调用失败',
                    description:
                        `模型组「${options.group.name}」调用失败。请使用其他模型组，或在设置中检查 provider。` +
                        (error instanceof Error ? `\n\n错误：${error.message}` : ''),
                })
            }
            throw error
        }
    }

    for (const [index, assignment] of attemptOrder.entries()) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        if (uiEnabled && index > 0) {
            const label = formatAssignmentLabel({ assignment, resolveConnectionName: options.resolveConnectionName })
            showFallbackToast(`上一个 provider 调用失败，正在尝试下一个：${label}（${index + 1}/${attemptOrder.length}）`)
        }

        try {
            const { stream: _stream, ...input } = options.input
            const request = {
                connectionId: assignment.connectionId,
                modelId: assignment.modelId,
                ...input,
            }
            const result = await aiApi.runModel(request, { signal: options.signal })

            if (strategy === 'round-robin') {
                setRoundRobinLastUsed(options.group.id, assignment.id)
            }

            if (assignment.failureCount !== 0 || assignment.ignoredUntil) {
                const updates = getResetAssignmentHealth()
                useAiRuntimeStore.getState().applyAssignmentOverride(assignment.id, updates)
                void aiApi.patchAssignment(assignment.id, updates).catch(() => null)
            }

            if (uiEnabled) hideFallbackToast()
            return { text: result.text, reasoningText: result.reasoningText, usedAssignment: assignment }
        } catch (error) {
            if (isAbortError(error)) {
                if (uiEnabled) hideFallbackToast()
                throw error
            }

            lastError = error
            const updates = computeFailureUpdates({ assignment, failurePolicy, nowMs: Date.now() })
            useAiRuntimeStore.getState().applyAssignmentOverride(assignment.id, updates)
            void aiApi.patchAssignment(assignment.id, updates).catch(() => null)

            const isLast = index === attemptOrder.length - 1
            if (isLast) {
                if (uiEnabled) {
                    hideFallbackToast()
                    const detail =
                        error instanceof ApiError
                            ? `（HTTP ${error.status}）`
                            : error instanceof Error
                              ? `（${error.message}）`
                              : ''
                    showFatalDialog({
                        title: '模型调用失败',
                        description:
                            `模型组「${options.group.name}」的所有 provider 全部不可用。请使用其他模型组，或在设置中手动启用已禁用的 provider。` +
                            (detail ? `\n\n最后一次错误：${detail}` : ''),
                    })
                }
                throw error
            }
        }
    }

    if (uiEnabled) {
        hideFallbackToast()
        showFatalDialog({
            title: '模型调用失败',
            description: `模型组「${options.group.name}」的所有 provider 全部不可用。请使用其他模型组，或在设置中手动启用已禁用的 provider。`,
        })
    }
    throw lastError instanceof Error ? lastError : new Error('All providers failed.')
}
