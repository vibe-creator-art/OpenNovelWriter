import type {
    ContentSelectionTarget,
    PromptCheckboxInputDefinition,
    PromptContentSelectionInputDefinition,
    PromptCustomInputDefinition,
    PromptDropdownOption,
    PromptInputDefinition,
} from '@/lib/prompt-inputs'
import type { PromptMessage } from '@/lib/prompts'
import type { ChapterWithScenes, Snippet } from '@/lib/api'
import type { DefaultTermCategoryId } from '@/components/editor/terms/types'
import type { TranslationFn } from '@/components/editor/prompt-inputs-editor/types'
import { extractStringArgCallsFromMessages } from '@/lib/prompt-template'
import { htmlToText } from '@/lib/html-to-text'
export {
    OPTION_COLOR_PALETTE,
    getOptionColorCardStyle,
    getOptionColorChipStyle,
    getOptionColorDotStyle,
} from '@/lib/color-palettes'

export { htmlToText }

export function isCustomInput(input: PromptInputDefinition): input is PromptCustomInputDefinition {
    return input.type === 'custom'
}

export function isContentSelectionInput(input: PromptInputDefinition): input is PromptContentSelectionInputDefinition {
    return input.type === 'content_selection'
}

export function isCheckboxInput(input: PromptInputDefinition): input is PromptCheckboxInputDefinition {
    return input.type === 'checkbox'
}

export function selectionKey(target: ContentSelectionTarget) {
    switch (target.kind) {
        case 'full_novel':
            return 'full_novel'
        case 'act':
            return `act:${target.actNumber}`
        case 'chapter':
            return `chapter:${target.chapterId}`
        case 'act_outline':
            return `act_outline:${target.actNumber}`
        case 'chapter_outline':
            return `chapter_outline:${target.chapterId}`
        case 'scene':
            return `scene:${target.sceneId}`
        case 'snippet':
            return `snippet:${target.snippetId}`
        case 'term':
            return `term:${target.termId}`
        case 'label':
            return `label:${target.labelId}`
        case 'term_tag':
            return `term_tag:${target.tag}`
    }
}

export function isDefaultTermCategoryId(categoryId: string): categoryId is DefaultTermCategoryId {
    return categoryId === 'characters' || categoryId === 'locations' || categoryId === 'items' || categoryId === 'lore'
}

export function getSnippetDisplayTitle(snippet: Snippet, fallback: string) {
    const title = snippet.title?.trim()
    if (title) return title
    const content = htmlToText(snippet.content).trim()
    if (content) return content.split('\n')[0]?.trim() || fallback
    return fallback
}

function compactText(value: string) {
    return value.replace(/\s+/g, '').trim()
}

function isPlaceholderChapterTitle({
    title,
    displayNumber,
    labelBase,
    chapterWord,
}: {
    title: string
    displayNumber: number
    labelBase: string
    chapterWord: string
}) {
    const compactTitle = compactText(title)
    if (!compactTitle) return true
    if (compactTitle === compactText(labelBase)) return true
    if (compactTitle === `${compactText(chapterWord)}${displayNumber}`) return true
    return false
}

export function getChapterDisplayLabel({
    title,
    displayNumber,
    labelBase,
    chapterWord,
    separator,
}: {
    title: string | null | undefined
    displayNumber: number
    labelBase: string
    chapterWord: string
    separator: string
}) {
    const trimmedTitle = title?.trim() ?? ''
    if (!trimmedTitle) return labelBase
    if (isPlaceholderChapterTitle({ title: trimmedTitle, displayNumber, labelBase, chapterWord })) return labelBase
    return `${labelBase}${separator}${trimmedTitle}`
}

export function getChapterTitleSeparator(t: TranslationFn) {
    // Use a more natural separator for Chinese; other locales fall back to ASCII ":".
    const probe = t('advanced.contentSelection.chapterLabel', { number: 1 })
    return probe.includes('第') ? '：' : ': '
}

export function buildPreviewSceneOptions(params: {
    chapters?: ChapterWithScenes[]
    t: TranslationFn
}) {
    const { chapters, t } = params
    const chapterTitleSeparator = getChapterTitleSeparator(t)
    const sortedChapters = [...(chapters ?? [])]
        .sort((a, b) => a.actNumber - b.actNumber || a.order - b.order)
        .map((chapter, index) => ({
            ...chapter,
            displayNumber: index + 1,
            scenes: [...(chapter.scenes ?? [])].sort((a, b) => a.order - b.order),
        }))

    const options: Array<{ id: string; label: string }> = []

    sortedChapters.forEach((chapter) => {
        const base = t('advanced.contentSelection.chapterLabel', { number: chapter.displayNumber })
        const chapterLabel = getChapterDisplayLabel({
            title: chapter.title,
            displayNumber: chapter.displayNumber,
            labelBase: base,
            chapterWord: t('advanced.contentSelection.chapter'),
            separator: chapterTitleSeparator,
        })

        chapter.scenes.forEach((scene, idx) => {
            const sceneLabel = t('advanced.contentSelection.sceneLabel', { number: idx + 1 })
            options.push({ id: scene.id, label: `${chapterLabel} · ${sceneLabel}` })
        })
    })

    return options
}

export function sortOptionsAlpha(options: PromptDropdownOption[]) {
    const normalized = options.map((opt, index) => ({ opt, index }))
    normalized.sort((a, b) => {
        const aLabel = a.opt.label.trim().toLowerCase()
        const bLabel = b.opt.label.trim().toLowerCase()
        const byLabel = aLabel.localeCompare(bLabel)
        return byLabel || a.index - b.index
    })
    return normalized.map((item) => item.opt)
}

export function extractCalledInputNames(messages: PromptMessage[]) {
    const called = extractStringArgCallsFromMessages(messages, 'input')
    const seen = new Set<string>()
    const result: string[] = []
    for (const name of called) {
        const trimmed = name.trim()
        if (!trimmed) continue
        const key = trimmed.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push(trimmed)
    }
    return result
}

export function buildMultiSelectionLabel(params: { selectedIds: string[]; options: PromptDropdownOption[]; t: TranslationFn }) {
    const { selectedIds, options, t } = params
    if (selectedIds.length === 0) return t('advanced.preview.noneSelected')
    const selectedLabels = selectedIds
        .map((id) => options.find((o) => o.id === id)?.label.trim())
        .filter((label): label is string => Boolean(label))
    if (selectedLabels.length === 0) return t('advanced.preview.selectedCount', { count: selectedIds.length })
    if (selectedLabels.length <= 2) return selectedLabels.join(', ')
    return t('advanced.preview.selectedCount', { count: selectedLabels.length })
}

export function buildSingleSelectionLabel(params: {
    selectedId: string | null
    options: PromptDropdownOption[]
    placeholder: string
}) {
    const { selectedId, options, placeholder } = params
    if (!selectedId) return placeholder
    return options.find((o) => o.id === selectedId)?.label.trim() || placeholder
}
