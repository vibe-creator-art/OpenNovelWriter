import type { CodexContextWindow, CodexTokenUsage } from '@/lib/api'

function getFiniteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getTokenUsage(value: unknown): CodexTokenUsage | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const inputTokens = getFiniteNumber(record.inputTokens ?? record.input_tokens)
    const cachedInputTokens = getFiniteNumber(record.cachedInputTokens ?? record.cached_input_tokens)
    const outputTokens = getFiniteNumber(record.outputTokens ?? record.output_tokens)
    const reasoningOutputTokens = getFiniteNumber(record.reasoningOutputTokens ?? record.reasoning_output_tokens)
    const totalTokens = getFiniteNumber(record.totalTokens ?? record.total_tokens)
    if (
        inputTokens === null ||
        cachedInputTokens === null ||
        outputTokens === null ||
        reasoningOutputTokens === null ||
        totalTokens === null
    ) {
        return null
    }
    return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens }
}

function toContextWindow(
    usedTokens: number,
    totalTokens: number,
    lastTokenUsage: CodexTokenUsage | null,
    totalTokenUsage: CodexTokenUsage | null
): CodexContextWindow {
    const remainingTokens = Math.max(0, totalTokens - usedTokens)
    const usagePercent = totalTokens > 0 ? Math.min(100, Math.max(0, usedTokens / totalTokens * 100)) : 0
    return {
        usedTokens,
        totalTokens,
        usagePercent,
        remainingTokens,
        lastTokenUsage,
        totalTokenUsage,
    }
}

function getContextWindowFromTokenCountPayload(payload: Record<string, unknown>): CodexContextWindow | null {
    if (payload.type !== 'token_count') return null
    const info = payload.info && typeof payload.info === 'object'
        ? payload.info as Record<string, unknown>
        : null
    if (!info) return null

    const totalTokens = getFiniteNumber(info.model_context_window ?? info.modelContextWindow)
    const lastTokenUsage = getTokenUsage(info.last_token_usage ?? info.lastTokenUsage)
    if (totalTokens === null || totalTokens <= 0 || !lastTokenUsage) return null

    return toContextWindow(
        lastTokenUsage.totalTokens,
        totalTokens,
        lastTokenUsage,
        getTokenUsage(info.total_token_usage ?? info.totalTokenUsage)
    )
}

/** Legacy JSONL / TUI `token_count` payload, including nested wrappers. */
export function getContextWindowFromTokenCount(value: unknown, depth = 0): CodexContextWindow | null {
    if (!value || typeof value !== 'object' || depth > 4) return null
    const record = value as Record<string, unknown>
    const direct = getContextWindowFromTokenCountPayload(record)
    if (direct) return direct

    for (const key of ['payload', 'event', 'item', 'message', 'msg', 'data']) {
        const nested = getContextWindowFromTokenCount(record[key], depth + 1)
        if (nested) return nested
    }

    return null
}

/**
 * Official app-server `thread/tokenUsage/updated` notification.
 * `last.totalTokens` is the current context occupancy; `total` is thread-lifetime usage.
 */
export function getContextWindowFromThreadTokenUsage(
    value: unknown,
    previous?: CodexContextWindow | null
): CodexContextWindow | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const tokenUsage = record.tokenUsage ?? record.token_usage
    if (!tokenUsage || typeof tokenUsage !== 'object') return null
    const usage = tokenUsage as Record<string, unknown>
    const lastTokenUsage = getTokenUsage(usage.last)
    if (!lastTokenUsage) return null

    const totalTokens = getFiniteNumber(usage.modelContextWindow ?? usage.model_context_window)
        ?? previous?.totalTokens
        ?? null
    if (totalTokens === null || totalTokens <= 0) return null

    return toContextWindow(
        lastTokenUsage.totalTokens,
        totalTokens,
        lastTokenUsage,
        getTokenUsage(usage.total)
    )
}

export function getContextWindowFromCodexNotification(
    method: string | undefined,
    params: unknown,
    previous?: CodexContextWindow | null
): CodexContextWindow | null {
    if (method === 'thread/tokenUsage/updated') {
        return getContextWindowFromThreadTokenUsage(params, previous)
    }
    return getContextWindowFromTokenCount(params)
}

export function getLatestContextWindowFromMessages(
    messages: Array<{ contextWindow?: CodexContextWindow | null }>
): CodexContextWindow | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const contextWindow = messages[index]?.contextWindow
        if (contextWindow) return contextWindow
    }
    return null
}
