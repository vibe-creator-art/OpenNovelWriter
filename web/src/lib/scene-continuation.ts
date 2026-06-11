type SceneLike = {
    id: string
    order: number
    content?: string | null
}

type ChapterLike<TScene extends SceneLike = SceneLike> = {
    id: string
    actNumber: number
    order: number
    scenes: TScene[]
}

function normalizeText(value: string | null | undefined) {
    return typeof value === 'string' ? value.trim() : ''
}

function sortChaptersForSceneContinuation<TScene extends SceneLike, TChapter extends ChapterLike<TScene>>(chapters: TChapter[]) {
    return [...chapters]
        .map((chapter) => ({
            ...chapter,
            scenes: [...(chapter.scenes ?? [])].sort((left, right) => {
                if (left.order !== right.order) return left.order - right.order
                return left.id.localeCompare(right.id)
            }),
        }))
        .sort((left, right) => {
            if (left.actNumber !== right.actNumber) return left.actNumber - right.actNumber
            if (left.order !== right.order) return left.order - right.order
            return left.id.localeCompare(right.id)
        })
}

export function findPreviousSceneContent<TScene extends SceneLike, TChapter extends ChapterLike<TScene>>(params: {
    chapters: TChapter[]
    currentSceneId?: string | null
    currentChapterId?: string | null
}) {
    const currentSceneId = normalizeText(params.currentSceneId)
    const currentChapterId = normalizeText(params.currentChapterId)
    const sortedChapters = sortChaptersForSceneContinuation(params.chapters ?? [])

    if (currentSceneId) {
        const orderedScenes = sortedChapters.flatMap((chapter) => chapter.scenes)
        const currentIndex = orderedScenes.findIndex((scene) => scene.id === currentSceneId)
        if (currentIndex > 0) return orderedScenes[currentIndex - 1]?.content ?? ''
        return ''
    }

    if (currentChapterId) {
        const chapterIndex = sortedChapters.findIndex((chapter) => chapter.id === currentChapterId)
        if (chapterIndex <= 0) return ''

        for (let index = chapterIndex - 1; index >= 0; index -= 1) {
            const previousChapter = sortedChapters[index]
            if (!previousChapter || previousChapter.scenes.length === 0) continue
            return previousChapter.scenes[previousChapter.scenes.length - 1]?.content ?? ''
        }
    }

    return ''
}
