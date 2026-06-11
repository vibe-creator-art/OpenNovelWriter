export function normalizeTermTitleKey(value: unknown) {
    if (typeof value !== 'string') return ''
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function getTermStateEntries(state: unknown): Array<Record<string, unknown>> {
    if (!state || typeof state !== 'object') return []
    const entries = (state as { entries?: unknown }).entries
    if (!Array.isArray(entries)) return []
    return entries.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
}

export function findDuplicateActiveTermTitle(state: unknown) {
    const seen = new Set<string>()

    for (const entry of getTermStateEntries(state)) {
        if (entry.archived === true) continue

        const key = normalizeTermTitleKey(entry.title)
        if (!key) continue

        if (seen.has(key)) {
            return typeof entry.title === 'string' ? entry.title.trim() : key
        }
        seen.add(key)
    }

    return null
}
