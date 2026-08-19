import type { CodexRateLimits, CodexRateLimitWindow } from '@/lib/api'

type CodexRateLimitSummaryKey = 'quotaWindow' | 'creditsUnlimited' | 'creditsBalance'

type CodexRateLimitTranslator = (
    key: CodexRateLimitSummaryKey,
    values?: Record<string, string | number>
) => string

export function formatCodexQuotaWindowLabel(minutes: number) {
    if (minutes % (24 * 60) === 0) {
        return `${minutes / (24 * 60)}d`
    }
    if (minutes % 60 === 0) {
        return `${minutes / 60}h`
    }
    return `${minutes}m`
}

export function isZeroCodexBalance(balance: string) {
    return Number(balance) === 0
}

export function hasMeaningfulCodexRateLimits(rateLimits: CodexRateLimits | null) {
    if (!rateLimits) return false
    if (rateLimits.primary?.windowDurationMins) return true
    if (rateLimits.secondary?.windowDurationMins) return true
    if (rateLimits.credits?.unlimited) return true
    if (rateLimits.credits?.balance && !isZeroCodexBalance(rateLimits.credits.balance)) return true
    return false
}

export function getCodexRateLimitSummary(
    rateLimits: CodexRateLimits | null,
    t: CodexRateLimitTranslator
) {
    if (!rateLimits) return []

    const lines: string[] = []

    for (const windowValue of [rateLimits.primary, rateLimits.secondary]) {
        if (!windowValue?.windowDurationMins) continue
        lines.push(
            t('quotaWindow', {
                window: formatCodexQuotaWindowLabel(windowValue.windowDurationMins),
                remaining: 100 - windowValue.usedPercent,
            })
        )
    }

    if (rateLimits.credits?.unlimited) {
        lines.push(t('creditsUnlimited'))
    } else if (rateLimits.credits?.balance && !isZeroCodexBalance(rateLimits.credits.balance)) {
        lines.push(t('creditsBalance', { balance: rateLimits.credits.balance }))
    }

    return lines
}

function getFiniteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseRateLimitWindow(value: unknown): CodexRateLimitWindow | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const usedPercent = getFiniteNumber(record.usedPercent ?? record.used_percent)
    if (usedPercent === null) return null
    const resetsAt = getFiniteNumber(record.resetsAt ?? record.resets_at)
    const windowDurationMins = getFiniteNumber(record.windowDurationMins ?? record.window_duration_mins)
    return {
        usedPercent,
        resetsAt: resetsAt,
        windowDurationMins: windowDurationMins ?? undefined,
    }
}

function parseCredits(value: unknown): NonNullable<CodexRateLimits['credits']> | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const balance = typeof record.balance === 'string' ? record.balance : null
    return {
        balance,
        hasCredits: typeof record.hasCredits === 'boolean' ? record.hasCredits : undefined,
        unlimited: typeof record.unlimited === 'boolean' ? record.unlimited : undefined,
    }
}

/** Parse an app-server `account/rateLimits/updated` snapshot or `account/rateLimits/read` result. */
export function parseCodexRateLimitSnapshot(value: unknown): CodexRateLimits | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const snapshot = record.rateLimits && typeof record.rateLimits === 'object'
        ? record.rateLimits as Record<string, unknown>
        : record

    const primary = parseRateLimitWindow(snapshot.primary)
    const secondary = parseRateLimitWindow(snapshot.secondary)
    const credits = parseCredits(snapshot.credits)
    const limitName = typeof snapshot.limitName === 'string' ? snapshot.limitName : snapshot.limitName === null ? null : undefined
    const limitId = typeof snapshot.limitId === 'string' ? snapshot.limitId : snapshot.limitId === null ? null : undefined
    const planType = typeof snapshot.planType === 'string' ? snapshot.planType : snapshot.planType === null ? null : undefined

    if (!primary && !secondary && !credits && limitName === undefined && limitId === undefined && planType === undefined) {
        return null
    }

    return {
        credits,
        limitName,
        limitId,
        planType,
        primary,
        secondary,
    }
}

function mergeRateLimitWindow(
    previous: CodexRateLimitWindow | null | undefined,
    next: CodexRateLimitWindow | null | undefined
): CodexRateLimitWindow | null {
    if (!next) return previous ?? null
    return {
        usedPercent: next.usedPercent,
        resetsAt: next.resetsAt ?? previous?.resetsAt ?? null,
        windowDurationMins: next.windowDurationMins ?? previous?.windowDurationMins,
    }
}

function mergeCredits(
    previous: CodexRateLimits['credits'] | null | undefined,
    next: CodexRateLimits['credits'] | null | undefined
): CodexRateLimits['credits'] {
    if (!next) return previous ?? null
    return {
        balance: next.balance ?? previous?.balance ?? null,
        hasCredits: next.hasCredits ?? previous?.hasCredits,
        unlimited: next.unlimited ?? previous?.unlimited,
    }
}

/**
 * Sparse merge for rolling `account/rateLimits/updated` notifications.
 * Null / missing account metadata does not clear a previously observed value.
 */
export function mergeCodexRateLimits(
    previous: CodexRateLimits | null | undefined,
    next: CodexRateLimits | null | undefined
): CodexRateLimits | null {
    if (!next) return previous ?? null
    if (!previous) return next
    return {
        credits: mergeCredits(previous.credits, next.credits),
        limitName: next.limitName ?? previous.limitName,
        limitId: next.limitId ?? previous.limitId,
        planType: next.planType ?? previous.planType,
        primary: mergeRateLimitWindow(previous.primary, next.primary),
        secondary: mergeRateLimitWindow(previous.secondary, next.secondary),
    }
}
