import type { Outline, OutlineType } from '@/lib/api'
import { htmlToText } from '@/lib/html-to-text'
import { buildMentionRegex, findMentionsInText, getMentionPhrasesFromTitleAndAliases } from '@/components/editor/terms/term-mentions-utils'

export type OutlineMention = {
    outlineId: string
    outlineType: OutlineType
    actNumber: number | null
    chapterId: string | null
    chapterIndex?: number
    chapterTitle?: string
    outlineUpdatedAt: string
    count: number
    before: string
    match: string
    after: string
    prefixEllipsis: boolean
    suffixEllipsis: boolean
}

function toTimestamp(iso: string): number {
    const time = new Date(iso).getTime()
    return Number.isFinite(time) ? time : 0
}

export function scanOutlineMentions(
    target: { title: string; aliases?: string },
    outlines: Outline[],
    options?: { snippetRadius?: number }
) {
    const snippetRadius = options?.snippetRadius ?? 80
    const phrases = getMentionPhrasesFromTitleAndAliases(target.title, target.aliases)
    const regex = buildMentionRegex(phrases)
    if (!regex) {
        return { count: 0, mentions: [] as OutlineMention[] }
    }

    const mentions: OutlineMention[] = []

    for (const outline of outlines) {
        if (!outline) continue
        const text = htmlToText(outline.content)
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
            outlineId: outline.id,
            outlineType: outline.type,
            actNumber: outline.actNumber,
            chapterId: outline.chapterId,
            outlineUpdatedAt: outline.updatedAt,
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
            b.count - a.count ||
            toTimestamp(b.outlineUpdatedAt) - toTimestamp(a.outlineUpdatedAt) ||
            a.outlineId.localeCompare(b.outlineId)
    )

    return {
        count: mentions.length,
        mentions,
    }
}
