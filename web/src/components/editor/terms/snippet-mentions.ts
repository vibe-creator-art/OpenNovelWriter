import type { Snippet } from '@/lib/api'
import { htmlToText } from '@/lib/html-to-text'
import { buildMentionRegex, findMentionsInText, getMentionPhrasesFromTitleAndAliases } from '@/components/editor/terms/term-mentions-utils'

export type SnippetMention = {
    snippetId: string
    snippetTitle: string
    snippetPinned: boolean
    snippetUpdatedAt: string
    count: number
    before: string
    match: string
    after: string
    prefixEllipsis: boolean
    suffixEllipsis: boolean
}

function getSnippetDisplayTitle(snippet: Snippet) {
    const title = snippet.title?.trim()
    if (title) return title

    const text = htmlToText(snippet.content).trim()
    if (!text) return ''

    const firstLine = text.split('\n').find((line) => line.trim()) ?? text
    return firstLine.trim()
}

function toTimestamp(iso: string): number {
    const time = new Date(iso).getTime()
    return Number.isFinite(time) ? time : 0
}

export function scanSnippetMentions(
    target: { title: string; aliases?: string },
    snippets: Snippet[],
    options?: { snippetRadius?: number }
) {
    const snippetRadius = options?.snippetRadius ?? 80
    const phrases = getMentionPhrasesFromTitleAndAliases(target.title, target.aliases)
    const regex = buildMentionRegex(phrases)
    if (!regex) {
        return { count: 0, mentions: [] as SnippetMention[] }
    }

    const mentions: SnippetMention[] = []

    for (const snippet of snippets) {
        if (!snippet) continue
        const text = htmlToText(snippet.content)
        if (!text) continue

        const matches = findMentionsInText(text, regex)
        if (matches.length === 0) continue

        const first = matches[0]
        const start = first.start
        const end = first.end

        const startSnippet = Math.max(0, start - snippetRadius)
        const endSnippet = Math.min(text.length, end + snippetRadius)

        const before = text.slice(startSnippet, start).replace(/\s+/g, ' ')
        const value = text.slice(start, end).replace(/\s+/g, ' ')
        const after = text.slice(end, endSnippet).replace(/\s+/g, ' ')

        mentions.push({
            snippetId: snippet.id,
            snippetTitle: getSnippetDisplayTitle(snippet),
            snippetPinned: snippet.pinned,
            snippetUpdatedAt: snippet.updatedAt,
            count: matches.length,
            before,
            match: value,
            after,
            prefixEllipsis: startSnippet > 0,
            suffixEllipsis: endSnippet < text.length,
        })
    }

    mentions.sort(
        (a, b) =>
            Number(b.snippetPinned) - Number(a.snippetPinned) ||
            b.count - a.count ||
            toTimestamp(b.snippetUpdatedAt) - toTimestamp(a.snippetUpdatedAt) ||
            a.snippetTitle.localeCompare(b.snippetTitle)
    )

    return {
        count: mentions.length,
        mentions,
    }
}
