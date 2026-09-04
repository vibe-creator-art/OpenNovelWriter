import { htmlToText } from '@/lib/html-to-text'
import {
    defaultActTitle,
    defaultChapterTitle,
    numberedActTitle,
    numberedChapterTitle,
    sceneHeading,
} from './labels'
import type {
    AssembleOptions,
    ExportAct,
    ExportChapter,
    ExportScene,
    ManuscriptBlock,
} from './types'

export function splitParagraphs(text: string) {
    return text
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
}

export function sceneProse(content: string) {
    return htmlToText(content ?? '', { paragraphSeparator: '\n\n' }).trim()
}

function sceneBlocks(scenes: ExportScene[], options: AssembleOptions): ManuscriptBlock[] {
    const ordered = [...scenes].sort((a, b) => a.order - b.order)
    const blocks: ManuscriptBlock[] = []

    if (options.sceneDivider === 'headings') {
        ordered.forEach((scene, index) => {
            blocks.push({ type: 'scene-heading', text: sceneHeading(options.language, index + 1) })
            const lines = splitParagraphs(sceneProse(scene.content))
            if (lines.length > 0) blocks.push({ type: 'paragraphs', lines })
        })
        return blocks
    }

    let emittedBody = false
    for (const scene of ordered) {
        const lines = splitParagraphs(sceneProse(scene.content))
        if (lines.length === 0) continue
        if (options.sceneDivider === 'asterisks' && emittedBody) {
            blocks.push({ type: 'scene-divider' })
        }
        blocks.push({ type: 'paragraphs', lines })
        emittedBody = true
    }
    return blocks
}

export function assembleManuscript(
    acts: ExportAct[],
    chapters: ExportChapter[],
    selectedChapterIds: Iterable<string>,
    options: AssembleOptions,
): ManuscriptBlock[] {
    const selected = new Set(selectedChapterIds)
    const chosen = chapters
        .filter((chapter) => selected.has(chapter.id))
        .sort((a, b) => (a.actNumber !== b.actNumber ? a.actNumber - b.actNumber : a.order - b.order))

    const actTitleByNumber = new Map(acts.map((act) => [act.number, act.title]))
    const chapterNumberById = new Map(
        [...chapters]
            .sort((a, b) => (a.actNumber !== b.actNumber ? a.actNumber - b.actNumber : a.order - b.order))
            .map((chapter, index) => [chapter.id, index + 1]),
    )
    const blocks: ManuscriptBlock[] = []
    let lastAct: number | null = null

    for (const chapter of chosen) {
        const chapterNumber = (
            typeof chapter.chapterNumber === 'number' && chapter.chapterNumber > 0
                ? chapter.chapterNumber
                : chapterNumberById.get(chapter.id)
        ) ?? Math.max(chapter.order, 1)

        if (options.includeActTitles && chapter.actNumber !== lastAct) {
            const stored = actTitleByNumber.get(chapter.actNumber)
            blocks.push({
                type: 'act-title',
                text: options.numberedHeadings
                    ? numberedActTitle(options.language, chapter.actNumber, stored)
                    : (stored?.trim() || defaultActTitle(options.language, chapter.actNumber)),
            })
            lastAct = chapter.actNumber
        }

        blocks.push({
            type: 'chapter-title',
            text: options.numberedHeadings
                ? numberedChapterTitle(options.language, chapterNumber, chapter.title)
                : (chapter.title.trim() || defaultChapterTitle(options.language, chapterNumber)),
        })
        blocks.push(...sceneBlocks(chapter.scenes ?? [], options))
    }

    return blocks
}
