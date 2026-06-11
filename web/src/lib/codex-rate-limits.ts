import type { CodexRateLimits } from '@/lib/api'

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
