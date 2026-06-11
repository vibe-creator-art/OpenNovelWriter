import { buildMentionRegex, findMentionsInText, getMentionPhrasesFromTitleAndAliases } from '@/components/editor/terms/term-mentions-utils'
import { getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import type { TermEntry, TermEntryColorId } from '@/components/editor/terms/types'

export type TermDescriptionMention = {
    entryId: string
    entryTitle: string
    entryColorId: TermEntryColorId
    count: number
    before: string
    match: string
    after: string
    prefixEllipsis: boolean
    suffixEllipsis: boolean
}

export function scanTermDescriptionMentions(
    target: { entryId: string; title: string; aliases?: string },
    entries: TermEntry[],
    options?: { snippetRadius?: number }
) {
    const snippetRadius = options?.snippetRadius ?? 80
    const phrases = getMentionPhrasesFromTitleAndAliases(target.title, target.aliases)
    const regex = buildMentionRegex(phrases)
    if (!regex) {
        return { count: 0, mentions: [] as TermDescriptionMention[] }
    }

    const mentions: TermDescriptionMention[] = []

    for (const entry of entries) {
        if (!entry || entry.archived) continue
        if (entry.id === target.entryId) continue

        const description = (entry.description ?? '').trim()
        if (!description) continue

        const matches = findMentionsInText(description, regex)
        if (matches.length === 0) continue

        const first = matches[0]
        const start = first.start
        const end = first.end

        const startSnippet = Math.max(0, start - snippetRadius)
        const endSnippet = Math.min(description.length, end + snippetRadius)

        const before = description.slice(startSnippet, start).replace(/\s+/g, ' ')
        const value = description.slice(start, end).replace(/\s+/g, ' ')
        const after = description.slice(end, endSnippet).replace(/\s+/g, ' ')

        mentions.push({
            entryId: entry.id,
            entryTitle: entry.title,
            entryColorId: getTermEntryColorId(entry.color),
            count: matches.length,
            before,
            match: value,
            after,
            prefixEllipsis: startSnippet > 0,
            suffixEllipsis: endSnippet < description.length,
        })
    }

    mentions.sort((a, b) => b.count - a.count || a.entryTitle.localeCompare(b.entryTitle))

    return {
        count: mentions.length,
        mentions,
    }
}

