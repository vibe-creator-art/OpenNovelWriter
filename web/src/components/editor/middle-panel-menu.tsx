'use client'

import { PlanView, type WriteNavTarget } from './plan-view'
import { ChapterWithScenes, NovelLabel, Scene } from '@/lib/api'

interface MiddlePanelMenuProps {
    novelId?: string
    chapters: ChapterWithScenes[]
    actsFromDb: { number: number; title: string | null }[]
    labels: NovelLabel[]
    emptyActs: Set<number>
    onReorderActs: (activeActNumber: number, overActNumber: number) => Promise<void>
    onReorderChapters: (updates: { id: string; order: number; actNumber: number }[]) => Promise<void>
    onCreateChapter: (actNumber: number) => void
    onCreateAct: () => void
    onDeleteChapter: (chapter: ChapterWithScenes) => void
    onDeleteAct: (actNumber: number) => void
    getGlobalChapterIndex: (chapterId: string) => number
    getActDisplayTitle: (actNumber: number) => string
    onScenesChange: (chapterId: string, scenes: Scene[]) => void
    onManageLabels: () => void
    onNavigateToWrite: (target: WriteNavTarget) => void
}

export function MiddlePanelMenu({
    novelId,
    chapters,
    actsFromDb,
    labels,
    emptyActs,
    onReorderActs,
    onReorderChapters,
    onCreateChapter,
    onCreateAct,
    onDeleteChapter,
    onDeleteAct,
    getGlobalChapterIndex,
    getActDisplayTitle,
    onScenesChange,
    onManageLabels,
    onNavigateToWrite,
}: MiddlePanelMenuProps) {
    return (
        <PlanView
            novelId={novelId}
            chapters={chapters}
            actsFromDb={actsFromDb}
            labels={labels}
            emptyActs={emptyActs}
            onReorderActs={onReorderActs}
            onReorderChapters={onReorderChapters}
            onCreateChapter={onCreateChapter}
            onCreateAct={onCreateAct}
            onDeleteChapter={onDeleteChapter}
            onDeleteAct={onDeleteAct}
            getGlobalChapterIndex={getGlobalChapterIndex}
            getActDisplayTitle={getActDisplayTitle}
            onScenesChange={onScenesChange}
            onManageLabels={onManageLabels}
            onNavigateToWrite={onNavigateToWrite}
        />
    )
}
