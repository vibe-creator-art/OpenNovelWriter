export function parseLabelIdsJson(raw: string | null | undefined): string[] {
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

export function serializeWithLabelIds<T extends { labelIdsJson: string }>(
    record: T
): Omit<T, 'labelIdsJson'> & { labelIds: string[] } {
    const { labelIdsJson, ...rest } = record
    return { ...(rest as Omit<T, 'labelIdsJson'>), labelIds: parseLabelIdsJson(labelIdsJson) }
}

export function normalizeLabelIds(labelIds: unknown): string[] | null {
    if (!Array.isArray(labelIds)) return null

    const normalized: string[] = []
    const seen = new Set<string>()
    for (const value of labelIds) {
        if (typeof value !== 'string') continue
        const trimmed = value.trim()
        if (!trimmed) continue
        if (seen.has(trimmed)) continue
        seen.add(trimmed)
        normalized.push(trimmed)
    }

    return normalized
}

