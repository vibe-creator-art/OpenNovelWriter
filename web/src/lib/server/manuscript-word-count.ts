import { createRequire } from 'module'
import type { PrismaClient, Scene } from '@prisma/client'

const require = createRequire(import.meta.url)

type SceneContentUpdateResult = {
    scene: Scene
    delta: number
    endingWordCount: number
}

const implementation = require('./manuscript-word-count.cjs') as {
    calculateManuscriptWordCount: (content: string) => number
    getLocalDateKey: (date?: Date) => string
    getNovelTotalWordCount: (db: unknown, novelId: string) => Promise<number>
    updateChapterWordCount: (db: unknown, chapterId: string) => Promise<number>
    recordNovelWritingDelta: (db: unknown, novelId: string, delta: number, dateKey?: string) => Promise<number>
    updateSceneContentWithStats: (
        prisma: PrismaClient,
        sceneId: string,
        content: string,
        options?: { recordStats?: boolean; dateKey?: string }
    ) => Promise<SceneContentUpdateResult>
}

export const calculateManuscriptWordCount = implementation.calculateManuscriptWordCount
export const getLocalDateKey = implementation.getLocalDateKey
export const getNovelTotalWordCount = implementation.getNovelTotalWordCount
export const updateChapterWordCount = implementation.updateChapterWordCount
export const recordNovelWritingDelta = implementation.recordNovelWritingDelta
export const updateSceneContentWithStats = implementation.updateSceneContentWithStats
