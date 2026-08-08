import { createRequire } from 'node:module'

import type { PrismaClient } from '@/generated/prisma/client'

const require = createRequire(import.meta.url)

type RetrievalDatabase = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

const implementation = require('./scene-retrieval-index.cjs') as {
    hashRetrievalText: (text: string) => string
    sceneHtmlToRetrievalText: (html: string) => string
    syncNovelSceneRetrievalIndexes: (
        db: RetrievalDatabase,
        novelId: string
    ) => Promise<{ sceneCount: number; updated: number }>
    syncSceneRetrievalIndex: (
        db: RetrievalDatabase,
        input: { sceneId: string; novelId: string; content: string }
    ) => Promise<unknown>
}

export const hashRetrievalText = implementation.hashRetrievalText
export const sceneHtmlToRetrievalText = implementation.sceneHtmlToRetrievalText
export const syncNovelSceneRetrievalIndexes = implementation.syncNovelSceneRetrievalIndexes
export const syncSceneRetrievalIndex = implementation.syncSceneRetrievalIndex
