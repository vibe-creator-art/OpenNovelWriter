export function parseTermIdsJson(raw: string | null | undefined): string[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []
        if (!parsed.every((value) => typeof value === 'string')) return []
        return parsed
    } catch {
        return []
    }
}

export function normalizeTermIds(termIds: unknown): string[] | null {
    if (!Array.isArray(termIds)) return null

    const normalized: string[] = []
    const seen = new Set<string>()
    for (const value of termIds) {
        if (typeof value !== 'string') continue
        const trimmed = value.trim()
        if (!trimmed) continue
        if (seen.has(trimmed)) continue
        seen.add(trimmed)
        normalized.push(trimmed)
    }

    return normalized
}

