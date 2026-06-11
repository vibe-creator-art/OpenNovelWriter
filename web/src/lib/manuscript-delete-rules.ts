import type { ChapterWithScenes, Scene } from '@/lib/api'
import { htmlToText } from '@/lib/html-to-text'

export const hasBodyText = (html: string | null | undefined) =>
    htmlToText(html ?? '', { paragraphSeparator: '\n' }).trim().length > 0

export const sceneHasBodyContent = (scene: Pick<Scene, 'content'>) => hasBodyText(scene.content)

export const chapterHasBodyContent = (chapter: Pick<ChapterWithScenes, 'scenes'>) =>
    (chapter.scenes ?? []).some(sceneHasBodyContent)

export const canDeleteChapterDirectly = (chapter: Pick<ChapterWithScenes, 'scenes'>) =>
    !chapterHasBodyContent(chapter)

export const canDeleteActDirectly = (chapters: Pick<ChapterWithScenes, 'scenes'>[]) =>
    chapters.every(canDeleteChapterDirectly)
