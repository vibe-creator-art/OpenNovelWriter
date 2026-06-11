import type { ModelAssignment, ModelGroupSettings, ModelTypeState } from '@/lib/ai-store'
import { detectCherryStudioModelTypes } from '@/lib/cherrystudio-model-config'

export type FailurePolicy = {
    maxFailures: number
    resetDays: number
}

export const DEFAULT_GROUP_SETTINGS: ModelGroupSettings = {
    strategy: 'priority',
    stream: true,
    temperature: 1,
    maxTokens: 20000,
}

export const DEFAULT_FAILURE_POLICY: FailurePolicy = {
    maxFailures: 3,
    resetDays: 3,
}

export function createEmptyModelTypeState(): ModelTypeState {
    return {
        vision: false,
        reasoning: false,
        tool: false,
        reranker: false,
        embedding: false,
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

export function normalizeGroupSettings(value: unknown): ModelGroupSettings {
    const record = asRecord(value)

    return {
        strategy: record.strategy === 'round-robin' ? 'round-robin' : DEFAULT_GROUP_SETTINGS.strategy,
        stream: typeof record.stream === 'boolean' ? record.stream : DEFAULT_GROUP_SETTINGS.stream,
        temperature: isFiniteNumber(record.temperature)
            ? Number(record.temperature)
            : DEFAULT_GROUP_SETTINGS.temperature,
        maxTokens: isFiniteNumber(record.maxTokens)
            ? Number(record.maxTokens)
            : DEFAULT_GROUP_SETTINGS.maxTokens,
    }
}

export function normalizeGroupModelTypes(value: unknown): ModelTypeState | null {
    if (typeof value !== 'object' || value === null) return null

    const record = value as Record<string, unknown>
    const state = createEmptyModelTypeState()

    return {
        vision: typeof record.vision === 'boolean' ? record.vision : state.vision,
        reasoning: typeof record.reasoning === 'boolean' ? record.reasoning : state.reasoning,
        tool: typeof record.tool === 'boolean' ? record.tool : state.tool,
        reranker: typeof record.reranker === 'boolean' ? record.reranker : state.reranker,
        embedding: typeof record.embedding === 'boolean' ? record.embedding : state.embedding,
    }
}

/**
 * Effective vision capability of a model group. `modelTypes` is a manual
 * override; when unset (null) the capability is auto-detected from the
 * assignment model ids — the same semantics the settings UI displays. A group
 * counts as vision-capable when any of its models is.
 */
export function isVisionCapableModelGroup(group: {
    modelTypes: ModelTypeState | null
    assignments?: Array<Pick<ModelAssignment, 'modelId'>> | null
}): boolean {
    if (group.modelTypes) return group.modelTypes.vision
    return (group.assignments ?? []).some(
        (assignment) => detectCherryStudioModelTypes({ modelId: assignment.modelId }).vision
    )
}

export function normalizeFailurePolicy(value: unknown): FailurePolicy {
    const record = asRecord(value)

    return {
        maxFailures: isFiniteNumber(record.maxFailures)
            ? Number(record.maxFailures)
            : DEFAULT_FAILURE_POLICY.maxFailures,
        resetDays: isFiniteNumber(record.resetDays)
            ? Number(record.resetDays)
            : DEFAULT_FAILURE_POLICY.resetDays,
    }
}

export function getResetAssignmentHealth(): Pick<
    ModelAssignment,
    'failureCount' | 'ignoredUntil' | 'manuallyDisabled'
> {
    return {
        failureCount: 0,
        ignoredUntil: null,
        manuallyDisabled: false,
    }
}

export function getIgnoredUntilTimestamp(ignoredUntil: string | null | undefined) {
    if (!ignoredUntil) return null

    const timestamp = Date.parse(ignoredUntil)
    return Number.isNaN(timestamp) ? null : timestamp
}

export function hasIgnoreWindowExpired(
    assignment: Pick<ModelAssignment, 'ignoredUntil'>,
    nowMs = Date.now()
) {
    const ignoredUntilTimestamp = getIgnoredUntilTimestamp(assignment.ignoredUntil)
    return ignoredUntilTimestamp !== null && ignoredUntilTimestamp <= nowMs
}

export function getConsecutiveFailureCount(
    assignment: Pick<ModelAssignment, 'failureCount' | 'ignoredUntil'>,
    nowMs = Date.now()
) {
    if (hasIgnoreWindowExpired(assignment, nowMs)) return 0
    return Number(assignment.failureCount || 0)
}

export function computeFailureUpdates(params: {
    assignment: Pick<ModelAssignment, 'failureCount' | 'ignoredUntil' | 'manuallyDisabled'>
    failurePolicy: FailurePolicy
    nowMs?: number
}) {
    const nowMs = params.nowMs ?? Date.now()
    const ignoreWindowExpired = hasIgnoreWindowExpired(params.assignment, nowMs)
    const nextFailureCount = getConsecutiveFailureCount(params.assignment, nowMs) + 1
    let ignoredUntil = ignoreWindowExpired ? null : params.assignment.ignoredUntil
    let manuallyDisabled = ignoreWindowExpired ? false : params.assignment.manuallyDisabled

    const { maxFailures, resetDays } = params.failurePolicy
    if (maxFailures > 0 && nextFailureCount >= maxFailures) {
        if (resetDays > 0) {
            ignoredUntil = new Date(nowMs + resetDays * 24 * 60 * 60 * 1000).toISOString()
            manuallyDisabled = false
        } else {
            ignoredUntil = null
            manuallyDisabled = true
        }
    }

    return { failureCount: nextFailureCount, ignoredUntil, manuallyDisabled }
}
