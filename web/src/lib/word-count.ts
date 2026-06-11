export function isCjkLanguage(language: string | null | undefined): boolean {
    const normalized = (language ?? '').trim().toLowerCase()
    return normalized.startsWith('zh') || normalized.startsWith('ja') || normalized.startsWith('ko')
}

export function countWordsByLanguage(text: string, language: string | null | undefined): number {
    const trimmed = (text ?? '').trim()
    if (!trimmed) return 0

    if (isCjkLanguage(language)) {
        return trimmed.replace(/\s/g, '').length
    }

    return trimmed.split(/\s+/).filter(Boolean).length
}

