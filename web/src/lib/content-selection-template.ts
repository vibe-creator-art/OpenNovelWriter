import type { ContentSelectionTarget, ContentSelectionTreatAs, PromptContentSelectionInputDefinition } from '@/lib/prompt-inputs'
import { htmlToText } from '@/lib/html-to-text'

type TemplateScene = {
    id: string
    order: number
    summary: string | null
    content: string
}

type TemplateChapter = {
    id: string
    title: string
    order: number
    actNumber: number
    scenes: TemplateScene[]
}

type TemplateAct = {
    number: number
    title: string | null
    summary?: string | null
}

export type ContentSelectionTemplateResources = {
    acts: TemplateAct[]
    chapters: TemplateChapter[]
    chaptersById: Map<string, TemplateChapter>
    scenesById: Map<string, TemplateScene>
    novelOutlineFull?: string | null
}

export type ContentSelectionTemplateListItem = {
    text: string
    value: string
}

export type ContentSelectionTemplateCollectionKind = 'fullNovel' | 'act' | 'chapter' | 'scene'

function normalizeLocale(locale: string | null | undefined) {
    return locale?.trim().toLowerCase() ?? ''
}

function isEnglishLocale(locale: string | null | undefined) {
    return normalizeLocale(locale).startsWith('en')
}

function formatFullNovelLabel(locale: string | null | undefined) {
    return isEnglishLocale(locale) ? 'Full Novel' : '全书'
}

function formatActLabel(actNumber: number, title: string | null | undefined, locale: string | null | undefined) {
    const base = isEnglishLocale(locale) ? `Act ${actNumber}` : `卷 ${actNumber}`
    const trimmedTitle = title?.trim() ?? ''
    return trimmedTitle ? `${base}: ${trimmedTitle}` : base
}

function formatChapterLabel(chapterNumber: number, title: string | null | undefined, locale: string | null | undefined) {
    const base = isEnglishLocale(locale) ? `Chapter ${chapterNumber}` : `第 ${chapterNumber} 章`
    const trimmedTitle = title?.trim() ?? ''
    return trimmedTitle ? `${base}: ${trimmedTitle}` : base
}

function formatSceneLabel(params: {
    chapterNumber: number
    chapterTitle: string | null | undefined
    sceneNumber: number
    locale: string | null | undefined
}) {
    const chapterLabel = formatChapterLabel(params.chapterNumber, params.chapterTitle, params.locale)
    const sceneLabel = isEnglishLocale(params.locale) ? `Scene ${params.sceneNumber}` : `场 ${params.sceneNumber}`
    return `${chapterLabel} · ${sceneLabel}`
}

function getSortedChapters(resources: ContentSelectionTemplateResources) {
    return [...resources.chapters].sort((left, right) => {
        if (left.order !== right.order) return left.order - right.order
        return left.id.localeCompare(right.id)
    })
}

function normalizeText(value: string | null | undefined) {
    return typeof value === 'string' ? value.trim() : ''
}

function buildStructuredBlock(heading: string, body?: string | null) {
    const normalizedHeading = normalizeText(heading)
    const normalizedBody = normalizeText(body)
    if (!normalizedHeading) return normalizedBody
    if (!normalizedBody) return ''
    return `${normalizedHeading}\n${normalizedBody}`.trim()
}

function getSceneRenderValue(scene: TemplateScene | null, treatAs: ContentSelectionTreatAs) {
    if (!scene) return ''
    if (treatAs === 'summary') return (scene.summary ?? '').trim()
    return htmlToText(scene.content ?? '', { paragraphSeparator: '\n' }).trim()
}

function buildSceneSection(params: {
    scene: TemplateScene | null
    chapterNumber: number
    chapterTitle: string | null | undefined
    sceneNumber: number
    treatAs: ContentSelectionTreatAs
    locale?: string | null
}) {
    const value = getSceneRenderValue(params.scene, params.treatAs)
    const heading = formatSceneLabel({
        chapterNumber: params.chapterNumber,
        chapterTitle: params.chapterTitle,
        sceneNumber: params.sceneNumber,
        locale: params.locale,
    })
    return buildStructuredBlock(heading, value)
}

function getSortedScenes(chapter: TemplateChapter | null) {
    return chapter
        ? chapter.scenes
              .slice()
              .sort((left, right) => {
                  if (left.order !== right.order) return left.order - right.order
                  return left.id.localeCompare(right.id)
              })
        : []
}

function getChapterRenderValue(
    chapter: TemplateChapter | null,
    treatAs: ContentSelectionTreatAs,
    params: {
        chapterNumber: number
        locale?: string | null
    }
) {
    if (!chapter) return ''
    const chapterHeading = formatChapterLabel(params.chapterNumber, chapter.title, params.locale)
    const sceneSections = getSortedScenes(chapter)
        .map((scene, index) =>
            buildSceneSection({
                scene,
                chapterNumber: params.chapterNumber,
                chapterTitle: chapter.title,
                sceneNumber: index + 1,
                treatAs,
                locale: params.locale,
            })
        )
        .filter(Boolean)
        .join('\n\n')
        .trim()
    return buildStructuredBlock(chapterHeading, sceneSections)
}

function getActRenderValue(
    act: TemplateAct | null,
    treatAs: ContentSelectionTreatAs,
    resources: ContentSelectionTemplateResources,
    params: {
        chapterNumberById: Map<string, number>
        locale?: string | null
    }
) {
    const actHeading = formatActLabel(act?.number ?? 0, act?.title ?? null, params.locale)

    if (treatAs === 'summary') {
        return buildStructuredBlock(actHeading, act?.summary ?? '')
    }

    const chapterSections = getSortedChapters(resources)
        .filter((chapter) => chapter.actNumber === act?.number)
        .map((chapter) =>
            getChapterRenderValue(chapter, treatAs, {
                chapterNumber: params.chapterNumberById.get(chapter.id) ?? 0,
                locale: params.locale,
            })
        )
        .filter(Boolean)
        .join('\n\n')
        .trim()

    return buildStructuredBlock(actHeading, chapterSections)
}

function getFullNovelRenderValue(
    treatAs: ContentSelectionTreatAs,
    resources: ContentSelectionTemplateResources,
    params: {
        chapterNumberById: Map<string, number>
        locale?: string | null
    }
) {
    if (treatAs === 'summary') {
        return normalizeText(resources.novelOutlineFull)
    }

    const actByNumber = new Map(resources.acts.map((act) => [act.number, act]))
    const actNumbers = [...new Set([...resources.acts.map((act) => act.number), ...resources.chapters.map((chapter) => chapter.actNumber)])].sort(
        (left, right) => left - right
    )

    return actNumbers
        .map((actNumber) =>
            getActRenderValue(actByNumber.get(actNumber) ?? { number: actNumber, title: null }, 'full_text', resources, {
                chapterNumberById: params.chapterNumberById,
                locale: params.locale,
            })
        )
        .filter(Boolean)
        .join('\n\n')
        .trim()
}

export function getContentSelectionTemplateItems(params: {
    kind: ContentSelectionTemplateCollectionKind
    input: PromptContentSelectionInputDefinition
    selections: ContentSelectionTarget[]
    resources: ContentSelectionTemplateResources
    locale?: string | null
}) {
    const sortedChapters = getSortedChapters(params.resources)
    const chapterNumberById = new Map(sortedChapters.map((chapter, index) => [chapter.id, index + 1]))
    const sceneMetaById = new Map<
        string,
        {
            chapter: TemplateChapter
            chapterNumber: number
            sceneNumber: number
        }
    >()

    for (const chapter of sortedChapters) {
        const chapterNumber = chapterNumberById.get(chapter.id) ?? 0
        const sortedScenes = chapter.scenes
            .slice()
            .sort((left, right) => {
                if (left.order !== right.order) return left.order - right.order
                return left.id.localeCompare(right.id)
            })
        sortedScenes.forEach((scene, index) => {
            sceneMetaById.set(scene.id, {
                chapter,
                chapterNumber,
                sceneNumber: index + 1,
            })
        })
    }

    if (params.kind === 'fullNovel') {
        const treatAs = params.input.contentSelection.options.fullNovel.treatAs
        return params.selections
            .filter((selection): selection is Extract<ContentSelectionTarget, { kind: 'full_novel' }> => selection.kind === 'full_novel')
            .map(() => ({
                text: formatFullNovelLabel(params.locale),
                value: getFullNovelRenderValue(treatAs, params.resources, {
                    chapterNumberById,
                    locale: params.locale,
                }),
            }))
            .filter((item) => item.text || item.value)
    }

    if (params.kind === 'act') {
        const treatAs = params.input.contentSelection.options.act.treatAs
        const actByNumber = new Map(params.resources.acts.map((act) => [act.number, act]))
        return params.selections
            .filter((selection): selection is Extract<ContentSelectionTarget, { kind: 'act' }> => selection.kind === 'act')
            .map((selection) => ({
                text: formatActLabel(selection.actNumber, actByNumber.get(selection.actNumber)?.title ?? null, params.locale),
                value: getActRenderValue(
                    actByNumber.get(selection.actNumber) ?? { number: selection.actNumber, title: null },
                    treatAs,
                    params.resources,
                    {
                        chapterNumberById,
                        locale: params.locale,
                    }
                ),
            }))
            .filter((item) => item.text || item.value)
    }

    if (params.kind === 'chapter') {
        const treatAs = params.input.contentSelection.options.chapter.treatAs
        return params.selections
            .filter((selection): selection is Extract<ContentSelectionTarget, { kind: 'chapter' }> => selection.kind === 'chapter')
            .map((selection) => {
                const chapter = params.resources.chaptersById.get(selection.chapterId) ?? null
                const chapterNumber = chapterNumberById.get(selection.chapterId) ?? 0
                return {
                    text: chapterNumber > 0 ? formatChapterLabel(chapterNumber, chapter?.title ?? null, params.locale) : (chapter?.title?.trim() ?? ''),
                    value: getChapterRenderValue(chapter, treatAs, {
                        chapterNumber,
                        locale: params.locale,
                    }),
                }
            })
            .filter((item) => item.text || item.value)
    }

    const treatAs = params.input.contentSelection.options.scene.treatAs
    return params.selections
        .filter((selection): selection is Extract<ContentSelectionTarget, { kind: 'scene' }> => selection.kind === 'scene')
        .map((selection) => {
            const scene = params.resources.scenesById.get(selection.sceneId) ?? null
            const sceneMeta = sceneMetaById.get(selection.sceneId) ?? null
            return {
                text:
                    sceneMeta
                        ? formatSceneLabel({
                              chapterNumber: sceneMeta.chapterNumber,
                              chapterTitle: sceneMeta.chapter.title,
                              sceneNumber: sceneMeta.sceneNumber,
                              locale: params.locale,
                          })
                        : '',
                value: sceneMeta
                    ? buildSceneSection({
                          scene,
                          chapterNumber: sceneMeta.chapterNumber,
                          chapterTitle: sceneMeta.chapter.title,
                          sceneNumber: sceneMeta.sceneNumber,
                          treatAs,
                          locale: params.locale,
                      })
                    : getSceneRenderValue(scene, treatAs),
            }
        })
        .filter((item) => item.text || item.value)
}
