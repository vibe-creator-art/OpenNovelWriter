import type { ChapterWithScenes } from '@/lib/api'
import { htmlToText } from '@/lib/html-to-text'
import {
    buildMentionRegex,
    countMentionsInText,
    findMentionsInText,
    getMentionPhrasesFromTitleAndAliases,
    type TextMentionMatch,
} from '@/components/editor/terms/term-mentions-utils'

export type ManuscriptMention = {
    chapterId: string
    sceneId: string
    sceneNumber: number
    before: string
    match: string
    after: string
    prefixEllipsis: boolean
    suffixEllipsis: boolean
}

export type ManuscriptMentionGroup = {
    chapterId: string
    chapterIndex: number
    chapterTitle: string
    count: number
    mentions: ManuscriptMention[]
}

export type SummaryMentionScene = {
    chapterId: string
    chapterIndex: number
    chapterTitle: string
    sceneId: string
    sceneNumber: number
    summary: string
    matches: TextMentionMatch[]
    count: number
}

export type ManuscriptMentionSparkline = {
    totalCount: number
    sceneMentions: number[]
}

export function scanEntryManuscriptMentionSparkline(
    entryTitle: string,
    entryAliases: string | undefined,
    chapters: ChapterWithScenes[],
) {
    const phrases = getMentionPhrasesFromTitleAndAliases(entryTitle, entryAliases)
    const regex = buildMentionRegex(phrases)
    if (!regex) {
        return { totalCount: 0, sceneMentions: [] as number[] }
    }

    const sortedChapters = [...chapters].sort((a, b) => a.actNumber - b.actNumber || a.order - b.order)
    const sceneMentions: number[] = []
    let totalCount = 0

    for (const chapter of sortedChapters) {
        const scenes = [...(chapter.scenes ?? [])].sort((a, b) => a.order - b.order)

        for (const scene of scenes) {
            const text = htmlToText(scene.content)
            if (!text) {
                sceneMentions.push(0)
                continue
            }

            const count = countMentionsInText(text, regex)
            totalCount += count
            sceneMentions.push(count > 0 ? 1 : 0)
        }
    }

    return { totalCount, sceneMentions }
}

export function scanEntryManuscriptMentions(
    entryTitle: string,
    entryAliases: string | undefined,
    chapters: ChapterWithScenes[],
    options?: { includeSnippets?: boolean; snippetRadius?: number }
) {
    const includeSnippets = options?.includeSnippets ?? false
    const snippetRadius = options?.snippetRadius ?? 80

    const phrases = getMentionPhrasesFromTitleAndAliases(entryTitle, entryAliases)
    const regex = buildMentionRegex(phrases)
    if (!regex) {
        return { totalCount: 0, groups: [] as ManuscriptMentionGroup[] }
    }

    const sortedChapters = [...chapters].sort((a, b) => a.actNumber - b.actNumber || a.order - b.order)
    const chapterIndexById = new Map(sortedChapters.map((chapter, idx) => [chapter.id, idx + 1] as const))

    const groups: ManuscriptMentionGroup[] = []
    let totalCount = 0

    for (const chapter of sortedChapters) {
        const scenes = [...(chapter.scenes ?? [])].sort((a, b) => a.order - b.order)
        const mentions: ManuscriptMention[] = []

        for (const [sceneIndex, scene] of scenes.entries()) {
            const text = htmlToText(scene.content)
            if (!text) continue

            const matches = findMentionsInText(text, regex)
            totalCount += matches.length
            if (!includeSnippets) continue

            for (const match of matches) {
                const start = match.start
                const end = match.end
                const startSnippet = Math.max(0, start - snippetRadius)
                const endSnippet = Math.min(text.length, end + snippetRadius)

                const before = text.slice(startSnippet, start).replace(/\s+/g, ' ')
                const value = text.slice(start, end).replace(/\s+/g, ' ')
                const after = text.slice(end, endSnippet).replace(/\s+/g, ' ')

                mentions.push({
                    chapterId: chapter.id,
                    sceneId: scene.id,
                    sceneNumber: sceneIndex + 1,
                    before,
                    match: value,
                    after,
                    prefixEllipsis: startSnippet > 0,
                    suffixEllipsis: endSnippet < text.length,
                })
            }
        }

        if (mentions.length > 0) {
            groups.push({
                chapterId: chapter.id,
                chapterIndex: chapterIndexById.get(chapter.id) ?? 0,
                chapterTitle: chapter.title,
                count: mentions.length,
                mentions,
            })
        }
    }

    return { totalCount, groups }
}

export function scanEntrySummaryMentionScenes(
    entryTitle: string,
    entryAliases: string | undefined,
    chapters: ChapterWithScenes[],
) {
    const phrases = getMentionPhrasesFromTitleAndAliases(entryTitle, entryAliases)
    const regex = buildMentionRegex(phrases)
    if (!regex) {
        return { totalCount: 0, scenes: [] as SummaryMentionScene[] }
    }

    const sortedChapters = [...chapters].sort((a, b) => a.actNumber - b.actNumber || a.order - b.order)
    const chapterIndexById = new Map(sortedChapters.map((chapter, idx) => [chapter.id, idx + 1] as const))

    const sceneMentions: SummaryMentionScene[] = []
    let totalCount = 0

    for (const chapter of sortedChapters) {
        const chapterScenes = [...(chapter.scenes ?? [])].sort((a, b) => a.order - b.order)

        for (const [sceneIndex, scene] of chapterScenes.entries()) {
            const summary = (scene.summary ?? '').trim()
            if (!summary) continue

            const matches = findMentionsInText(summary, regex)
            if (matches.length === 0) continue

            totalCount += matches.length
            sceneMentions.push({
                chapterId: chapter.id,
                chapterIndex: chapterIndexById.get(chapter.id) ?? 0,
                chapterTitle: chapter.title,
                sceneId: scene.id,
                sceneNumber: sceneIndex + 1,
                summary,
                matches,
                count: matches.length,
            })
        }
    }

    return {
        totalCount,
        scenes: sceneMentions.slice().sort((a, b) => a.chapterIndex - b.chapterIndex || a.sceneNumber - b.sceneNumber),
    }
}
