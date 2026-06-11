'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { ChapterWithScenes, Novel, Prompt, Scene } from '@/lib/api'
import type { TermMentionMatcher } from '@/components/editor/terms/term-mentions-utils'
import type { TermEntry } from '@/components/editor/terms/types'

export type SceneContinuationContextValue = {
    novelId?: string
    chapterId: string
    chapterTitle?: string
    sceneId: string
    scenes: Scene[]
    localEdits: Record<string, string>
    ensureComponentPrompts: () => Promise<Prompt[]>
    ensureNovelData: () => Promise<(Novel & { chapters: ChapterWithScenes[] }) | null>
    termMentionMatcher?: TermMentionMatcher | null
    termEntries: TermEntry[]
    onOpenRightSidebar?: () => void
}

const SceneContinuationContext = createContext<SceneContinuationContextValue | null>(null)

export function SceneContinuationContextProvider({
    value,
    children,
}: {
    value: SceneContinuationContextValue
    children: ReactNode
}) {
    return <SceneContinuationContext.Provider value={value}>{children}</SceneContinuationContext.Provider>
}

export function useSceneContinuationContext() {
    const ctx = useContext(SceneContinuationContext)
    if (!ctx) {
        throw new Error('useSceneContinuationContext must be used within SceneContinuationContextProvider')
    }
    return ctx
}
