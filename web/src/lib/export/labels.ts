function languageKey(language: string | null | undefined) {
    const value = (language ?? 'en').trim().toLowerCase()
    if (value.startsWith('zh-tw') || value.startsWith('zh-hant')) return 'zh-TW'
    if (value.startsWith('zh')) return 'zh'
    if (value.startsWith('ja')) return 'ja'
    if (value.startsWith('ko')) return 'ko'
    if (value.startsWith('es')) return 'es'
    if (value.startsWith('fr')) return 'fr'
    if (value.startsWith('de')) return 'de'
    return 'en'
}

export function defaultActTitle(language: string | null | undefined, number: number) {
    switch (languageKey(language)) {
        case 'zh':
        case 'zh-TW':
            return `卷 ${number}`
        case 'ja':
            return `幕 ${number}`
        case 'ko':
            return `${number}막`
        default:
            return `Act ${number}`
    }
}

export function defaultChapterTitle(language: string | null | undefined, number: number) {
    switch (languageKey(language)) {
        case 'zh':
        case 'zh-TW':
            return `章 ${number}`
        case 'ja':
            return `第${number}章`
        case 'ko':
            return `${number}장`
        default:
            return `Chapter ${number}`
    }
}

export function actNumberLabel(language: string | null | undefined, number: number) {
    switch (languageKey(language)) {
        case 'zh':
        case 'zh-TW':
            return `第${number}卷`
        case 'ja':
            return `第${number}幕`
        case 'ko':
            return `${number}막`
        default:
            return `Act ${number}`
    }
}

export function chapterNumberLabel(language: string | null | undefined, number: number) {
    switch (languageKey(language)) {
        case 'zh':
        case 'zh-TW':
        case 'ja':
            return `第${number}章`
        case 'ko':
            return `${number}장`
        default:
            return `Chapter ${number}`
    }
}

function isPlaceholderActTitle(title: string) {
    return /^(?:卷\s*\d+|Act\s+\d+|幕\s+\d+|\d+막)$/i.test(title)
}

function isPlaceholderChapterTitle(title: string) {
    return /^(?:章\s*\d+|Chapter\s+\d+|第\s*\d+\s*章|\d+장)$/i.test(title)
}

function joinNumberedTitle(
    prefix: string,
    title: string | null | undefined,
    isPlaceholder: (title: string) => boolean,
    language: string | null | undefined,
) {
    const trimmed = title?.trim() ?? ''
    if (!trimmed || isPlaceholder(trimmed)) return prefix

    const compactPrefix = prefix.replace(/\s+/g, '')
    const compactTitle = trimmed.replace(/\s+/g, '')
    if (compactTitle === compactPrefix || compactTitle.startsWith(compactPrefix)) return trimmed

    const key = languageKey(language)
    if (key === 'zh' || key === 'zh-TW' || key === 'ja' || key === 'ko') {
        return `${prefix} ${trimmed}`
    }
    return `${prefix}: ${trimmed}`
}

export function numberedActTitle(
    language: string | null | undefined,
    number: number,
    storedTitle: string | null | undefined,
) {
    return joinNumberedTitle(actNumberLabel(language, number), storedTitle, isPlaceholderActTitle, language)
}

export function numberedChapterTitle(
    language: string | null | undefined,
    number: number,
    storedTitle: string | null | undefined,
) {
    return joinNumberedTitle(chapterNumberLabel(language, number), storedTitle, isPlaceholderChapterTitle, language)
}

export function sceneHeading(language: string | null | undefined, number: number) {
    switch (languageKey(language)) {
        case 'zh':
            return `场 ${number}`
        case 'zh-TW':
            return `場 ${number}`
        case 'ja':
            return `シーン ${number}`
        case 'ko':
            return `장면 ${number}`
        case 'es':
            return `Escena ${number}`
        case 'fr':
            return `Scène ${number}`
        case 'de':
            return `Szene ${number}`
        default:
            return `Scene ${number}`
    }
}

export const SCENE_ASTERISK_DIVIDER = '* * *'
