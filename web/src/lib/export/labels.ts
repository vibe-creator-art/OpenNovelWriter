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
