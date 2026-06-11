export type NovelOutlineAct = {
    number: number
    title?: string | null
    summary?: string | null
}

export type NovelOutlineScene = {
    id: string
    order: number
    summary?: string | null
}

export type NovelOutlineChapter = {
    id: string
    title?: string | null
    actNumber: number
    order: number
    scenes: NovelOutlineScene[]
}

export type NovelOutlineTexts = {
    full: string
    storysofar: string
}

type NovelOutlinePosition = {
    chapterIndex: number
    sceneIndex: number | null
    actNumber: number
}

function normalizeText(value: string | null | undefined) {
    return typeof value === 'string' ? value.trim() : ''
}

function isChineseLanguage(language: string | null | undefined) {
    return normalizeText(language).toLowerCase().startsWith('zh')
}

function formatActHeading(actNumber: number, title: string | null | undefined, language?: string | null) {
    const trimmedTitle = normalizeText(title)
    if (isChineseLanguage(language)) {
        return trimmedTitle ? `第 ${actNumber} 卷：${trimmedTitle}` : `第 ${actNumber} 卷`
    }
    return trimmedTitle ? `Act ${actNumber}: ${trimmedTitle}` : `Act ${actNumber}`
}

function formatSceneHeading(chapterNumber: number, chapterTitle: string | null | undefined, sceneNumber: number, language?: string | null) {
    const trimmedTitle = normalizeText(chapterTitle)
    if (isChineseLanguage(language)) {
        return trimmedTitle
            ? `第 ${chapterNumber} 章 ${trimmedTitle} 场 ${sceneNumber}`
            : `第 ${chapterNumber} 章 场 ${sceneNumber}`
    }
    return trimmedTitle
        ? `Chapter ${chapterNumber} ${trimmedTitle} Scene ${sceneNumber}`
        : `Chapter ${chapterNumber} Scene ${sceneNumber}`
}

function resolveCurrentPosition(params: {
    chapters: NovelOutlineChapter[]
    currentChapterId?: string | null
    currentSceneId?: string | null
}) {
    const currentSceneId = normalizeText(params.currentSceneId)
    const currentChapterId = normalizeText(params.currentChapterId)

    if (currentSceneId) {
        for (const [chapterIndex, chapter] of params.chapters.entries()) {
            const sceneIndex = chapter.scenes.findIndex((scene) => scene.id === currentSceneId)
            if (sceneIndex < 0) continue
            return {
                chapterIndex,
                sceneIndex,
                actNumber: chapter.actNumber,
            } satisfies NovelOutlinePosition
        }
    }

    if (currentChapterId) {
        const chapterIndex = params.chapters.findIndex((chapter) => chapter.id === currentChapterId)
        if (chapterIndex >= 0) {
            return {
                chapterIndex,
                sceneIndex: null,
                actNumber: params.chapters[chapterIndex].actNumber,
            } satisfies NovelOutlinePosition
        }
    }

    return null
}

function shouldIncludeActStorySoFar(actNumber: number, currentPosition: NovelOutlinePosition | null) {
    if (!currentPosition) return true
    return actNumber < currentPosition.actNumber
}

function shouldIncludeSceneStorySoFar(params: {
    chapterIndex: number
    sceneIndex: number
    currentPosition: NovelOutlinePosition | null
}) {
    const { chapterIndex, sceneIndex, currentPosition } = params
    if (!currentPosition) return true
    if (chapterIndex < currentPosition.chapterIndex) return true
    if (chapterIndex > currentPosition.chapterIndex) return false
    if (currentPosition.sceneIndex == null) return false
    return sceneIndex < currentPosition.sceneIndex
}

function buildOutlineBlock(heading: string, summary?: string | null) {
    const normalizedHeading = normalizeText(heading)
    const normalizedSummary = normalizeText(summary)
    if (!normalizedHeading) return ''
    if (!normalizedSummary) return normalizedHeading
    return `${normalizedHeading}\n${normalizedSummary}`
}

export function buildNovelOutlineTexts(params: {
    acts?: NovelOutlineAct[] | null
    chapters?: NovelOutlineChapter[] | null
    currentChapterId?: string | null
    currentSceneId?: string | null
    language?: string | null
}): NovelOutlineTexts {
    const sortedChapters = [...(params.chapters ?? [])]
        .map((chapter) => ({
            ...chapter,
            scenes: [...(chapter.scenes ?? [])].sort((left, right) => left.order - right.order),
        }))
        .sort((left, right) => {
            if (left.actNumber !== right.actNumber) return left.actNumber - right.actNumber
            if (left.order !== right.order) return left.order - right.order
            return left.id.localeCompare(right.id)
        })

    const actByNumber = new Map<number, NovelOutlineAct>()
    for (const act of params.acts ?? []) {
        if (!Number.isInteger(act.number) || act.number <= 0) continue
        actByNumber.set(act.number, act)
    }

    const chapterNumbersById = new Map<string, number>()
    sortedChapters.forEach((chapter, index) => {
        chapterNumbersById.set(chapter.id, index + 1)
    })

    const currentPosition = resolveCurrentPosition({
        chapters: sortedChapters,
        currentChapterId: params.currentChapterId,
        currentSceneId: params.currentSceneId,
    })

    const actNumbers = [...new Set([...actByNumber.keys(), ...sortedChapters.map((chapter) => chapter.actNumber)])].sort((a, b) => a - b)
    const fullSections: string[] = []
    const storySoFarSections: string[] = []

    for (const actNumber of actNumbers) {
        const act = actByNumber.get(actNumber) ?? null
        const actSummary = normalizeText(act?.summary)
        const actHeading = formatActHeading(actNumber, act?.title, params.language)
        const actChapters = sortedChapters.filter((chapter) => chapter.actNumber === actNumber)

        const fullBlocks = [buildOutlineBlock(actHeading, actSummary)]
        const storySoFarBlocks = [buildOutlineBlock(actHeading, shouldIncludeActStorySoFar(actNumber, currentPosition) ? actSummary : null)]

        actChapters.forEach((chapter, chapterIndexWithinAct) => {
            const chapterIndex = sortedChapters.findIndex((item) => item.id === chapter.id)
            const chapterNumber = chapterNumbersById.get(chapter.id) ?? chapterIndexWithinAct + 1

            chapter.scenes.forEach((scene, sceneIndex) => {
                const sceneSummary = normalizeText(scene.summary)
                if (!sceneSummary) return

                const sceneHeading = formatSceneHeading(chapterNumber, chapter.title, sceneIndex + 1, params.language)
                fullBlocks.push(buildOutlineBlock(sceneHeading, sceneSummary))

                if (
                    shouldIncludeSceneStorySoFar({
                        chapterIndex,
                        sceneIndex,
                        currentPosition,
                    })
                ) {
                    storySoFarBlocks.push(buildOutlineBlock(sceneHeading, sceneSummary))
                }
            })
        })

        const fullSection = fullBlocks.filter(Boolean).join('\n\n').trim()
        if (fullSection !== actHeading) {
            fullSections.push(fullSection)
        }

        const storySoFarSection = storySoFarBlocks.filter(Boolean).join('\n\n').trim()
        if (storySoFarSection !== actHeading) {
            storySoFarSections.push(storySoFarSection)
        }
    }

    return {
        full: fullSections.join('\n\n').trim(),
        storysofar: storySoFarSections.join('\n\n').trim(),
    }
}
