import type { TermEntry, TermEntryColorId } from '@/components/editor/terms/types'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'

export type TermMentionToken = {
    termId: string
    colorId: TermEntryColorId
}

export type TermMentionMatcher = {
    regex: RegExp | null
    tokenByPhraseKey: Map<string, TermMentionToken>
}

export const EMPTY_TERM_MENTION_MATCHER: TermMentionMatcher = {
    regex: null,
    tokenByPhraseKey: new Map(),
}

export function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function toMentionPhraseKey(value: string) {
    return value.trim().toLocaleLowerCase()
}

export function splitAliases(raw: string | undefined) {
    if (!raw) return []
    return raw
        .split(/[,\uFF0C\u3001;\uFF1B\n]/g)
        .map((part) => part.trim())
        .filter(Boolean)
}

export function getEntryMentionPhrases(entry: TermEntry) {
    return getMentionPhrasesFromTitleAndAliases(entry.title, entry.aliases)
}

export function getMentionPhrasesFromTitleAndAliases(title: string, aliases?: string) {
    const phrases: string[] = []
    const seen = new Set<string>()

    const add = (raw: string) => {
        const key = toMentionPhraseKey(raw)
        if (!key) return
        if (seen.has(key)) return
        seen.add(key)
        phrases.push(raw.trim())
    }

    if (title?.trim()) add(title)
    for (const alias of splitAliases(aliases)) add(alias)

    return phrases
}

export function buildMentionRegex(phrases: string[]) {
    const cleaned = phrases.map((p) => p.trim()).filter(Boolean)
    if (cleaned.length === 0) return null

    const unique: string[] = []
    const seen = new Set<string>()
    for (const phrase of cleaned) {
        const key = toMentionPhraseKey(phrase)
        if (!key || seen.has(key)) continue
        seen.add(key)
        unique.push(phrase)
    }

    const sorted = unique.slice().sort((a, b) => b.length - a.length || a.localeCompare(b))
    try {
        return new RegExp(sorted.map(escapeRegExp).join('|'), 'gi')
    } catch {
        return null
    }
}

export function buildTermMentionMatcher(entries: TermEntry[]): TermMentionMatcher {
    const tokenByPhraseKey = new Map<string, TermMentionToken>()
    const phrases: string[] = []

    for (const entry of entries) {
        if (entry.archived) continue
        const colorId = getTermEntryColorId(entry.color)
        const token: TermMentionToken = { termId: entry.id, colorId }
        for (const phrase of getEntryMentionPhrases(entry)) {
            const key = toMentionPhraseKey(phrase)
            if (!key) continue
            if (tokenByPhraseKey.has(key)) continue
            tokenByPhraseKey.set(key, token)
            phrases.push(phrase)
        }
    }

    return {
        regex: buildMentionRegex(phrases),
        tokenByPhraseKey,
    }
}

export type MentionDecoration = {
    className: string
    style?: string
    reactStyle?: { textDecorationColor: string }
}

export function getMentionDecoration(token: TermMentionToken): MentionDecoration {
    const base = 'term-mention underline underline-offset-2 decoration-2 cursor-pointer'

    if (token.colorId === 'black') {
        const decorationColor = 'hsl(var(--muted-foreground) / 0.55)'
        return {
            className: `${base}`,
            style: `text-decoration-color: ${decorationColor};`,
            reactStyle: { textDecorationColor: decorationColor },
        }
    }

    const classes = getTermEntryColorClasses(token.colorId)
    return {
        className: `${base} ${classes.text} decoration-current`,
        style: undefined,
        reactStyle: undefined,
    }
}

export type TextMentionMatch = {
    start: number
    end: number
    text: string
}

export function findMentionsInText(text: string, regex: RegExp) {
    const matches: TextMentionMatch[] = []
    regex.lastIndex = 0

    let m: RegExpExecArray | null = null
    while ((m = regex.exec(text))) {
        const value = m[0] ?? ''
        const start = m.index ?? 0
        if (!value) {
            // Avoid infinite loops for empty matches.
            regex.lastIndex = start + 1
            continue
        }
        matches.push({ start, end: start + value.length, text: value })
    }

    return matches
}

export function findMentionedTermIds(text: string, matcher: TermMentionMatcher | null | undefined) {
    const regex = matcher?.regex ?? null
    if (!text || !regex || !matcher || matcher.tokenByPhraseKey.size === 0) return new Set<string>()

    const cloned = new RegExp(regex.source, regex.flags)
    const matches = findMentionsInText(text, cloned)
    const detected = new Set<string>()

    for (const match of matches) {
        const token = matcher.tokenByPhraseKey.get(toMentionPhraseKey(match.text))
        if (!token) continue
        detected.add(token.termId)
    }

    return detected
}

export function countMentionsInText(text: string, regex: RegExp) {
    let count = 0
    regex.lastIndex = 0

    let m: RegExpExecArray | null = null
    while ((m = regex.exec(text))) {
        const value = m[0] ?? ''
        const start = m.index ?? 0
        if (!value) {
            // Avoid infinite loops for empty matches.
            regex.lastIndex = start + 1
            continue
        }
        count += 1
    }

    return count
}
