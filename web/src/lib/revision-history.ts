export type RevisionHistoryItem = {
    id: string
    ts: number
    value: string
}

export type RevisionHistoryCoerceOptions = {
    maxItems?: number
    idPrefix?: string
}

export type RecordRevisionHistoryOptions = {
    now?: number
    maxItems?: number
    minIntervalMs?: number
    idPrefix?: string
    normalize?: (value: string) => string
    ignoreMinInterval?: boolean
}

export const DEFAULT_MAX_REVISION_HISTORY_ITEMS = 50
export const DEFAULT_MIN_REVISION_HISTORY_INTERVAL_MS = 10_000

export function createRevisionHistoryId(prefix = 'rev') {
    if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
        return globalThis.crypto.randomUUID()
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

export function coerceRevisionHistoryItems(rawItems: unknown, options?: RevisionHistoryCoerceOptions): RevisionHistoryItem[] {
    if (!Array.isArray(rawItems)) return []

    const maxItems = options?.maxItems ?? DEFAULT_MAX_REVISION_HISTORY_ITEMS
    const idPrefix = options?.idPrefix ?? 'rev'

    const items: RevisionHistoryItem[] = []

    for (const raw of rawItems) {
        if (!raw || typeof raw !== 'object') continue
        const record = raw as Record<string, unknown>
        const id = typeof record.id === 'string' && record.id.trim() ? record.id : createRevisionHistoryId(idPrefix)
        const ts = typeof record.ts === 'number' && Number.isFinite(record.ts) ? record.ts : Date.now()
        const value =
            typeof record.value === 'string'
                ? record.value
                : typeof record.content === 'string'
                    ? record.content
                    : typeof record.description === 'string'
                        ? record.description
                        : ''
        items.push({ id, ts, value })
    }

    items.sort((a, b) => b.ts - a.ts)
    return items.slice(0, maxItems)
}

export function safeParseRevisionHistoryJson(raw: string | null | undefined, options?: RevisionHistoryCoerceOptions): RevisionHistoryItem[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw) as unknown
        return coerceRevisionHistoryItems(parsed, options)
    } catch {
        return []
    }
}

export function recordRevisionHistory(
    history: RevisionHistoryItem[],
    nextValue: string,
    options?: RecordRevisionHistoryOptions
): { history: RevisionHistoryItem[]; recorded: boolean; item?: RevisionHistoryItem } {
    const now = options?.now ?? Date.now()
    const maxItems = options?.maxItems ?? DEFAULT_MAX_REVISION_HISTORY_ITEMS
    const minIntervalMs = options?.minIntervalMs ?? DEFAULT_MIN_REVISION_HISTORY_INTERVAL_MS
    const normalize = options?.normalize ?? ((value: string) => value)
    const idPrefix = options?.idPrefix ?? 'rev'
    const ignoreMinInterval = options?.ignoreMinInterval ?? false

    const value = normalize(nextValue)
    if (!value) return { history, recorded: false }

    const last = history[0]
    if (last?.value === value) return { history, recorded: false }
    if (!ignoreMinInterval && last && now - last.ts < minIntervalMs) {
        return { history, recorded: false }
    }

    const item: RevisionHistoryItem = { id: createRevisionHistoryId(idPrefix), ts: now, value }
    const nextHistory = [item, ...history].slice(0, maxItems)
    return { history: nextHistory, recorded: true, item }
}
