'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import {
    DndContext,
    DragEndEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    closestCorners,
    KeyboardSensor,
    PointerSensor,
    pointerWithin,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    GripVertical,
    Plus,
    Edit3,
    MoreVertical,
    Trash2,
    Tag,
    X,
} from 'lucide-react'
import { ChapterWithScenes, NovelLabel, Scene, sceneApi } from '@/lib/api'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import { buildTermMentionMatcher, findMentionedTermIds } from '@/components/editor/terms/term-mentions-utils'
import type { TermEntry } from '@/components/editor/terms/types'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import { htmlToText } from '@/lib/html-to-text'
import { cn } from '@/lib/utils'
import { canDeleteActDirectly, canDeleteChapterDirectly } from '@/lib/manuscript-delete-rules'

export type WriteNavTarget =
    | { kind: 'act'; actNumber: number }
    | { kind: 'chapter'; chapterId: string }
    | { kind: 'scene'; chapterId: string; sceneId: string }

interface PlanViewProps {
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

// Chapter Card Content Component (shared between sortable and overlay)
function ChapterCardContent({
    chapter,
    globalIndex,
    labels,
    labelsById,
    termEntriesById,
    onDeleteChapter,
    onScenesChange,
    onManageLabels,
    onNavigateToWrite,
    isDragOverlay = false,
    t,
    tCommon,
    tLabels,
}: {
    chapter: ChapterWithScenes
    globalIndex: number
    labels: NovelLabel[]
    labelsById: Map<string, NovelLabel>
    termEntriesById: Map<string, TermEntry>
    onDeleteChapter: (chapter: ChapterWithScenes) => void
    onScenesChange: (chapterId: string, scenes: Scene[]) => void
    onManageLabels: () => void
    onNavigateToWrite: (target: WriteNavTarget) => void
    isDragOverlay?: boolean
    t: (key: string) => string
    tCommon: (key: string) => string
    tLabels: (key: string) => string
}) {
    const chapterLabel = t('chapter.label')
    const sceneLabel = t('scene.label')
    const canDeleteDirectly = canDeleteChapterDirectly(chapter)
    const scenes = chapter.scenes ?? []
    const [activeSceneIndex, setActiveSceneIndex] = useState(0)
    const [termPickerOpen, setTermPickerOpen] = useState(false)
    const [termQuery, setTermQuery] = useState('')
    const [isCreatingScene, setIsCreatingScene] = useState(false)
    const displayedSceneIndex = scenes.length > 0 ? Math.min(activeSceneIndex, scenes.length - 1) : 0
    const activeScene = scenes[displayedSceneIndex] ?? null
    const sceneSummary = activeScene?.summary?.trim() ?? ''
    const sceneText = activeScene ? htmlToText(activeScene.content ?? '', { paragraphSeparator: '\n' }) : ''
    const manualTermIds = activeScene?.termIds ?? []
    const manualTermSet = new Set(manualTermIds)
    const detectedTermIds = activeScene
        ? findMentionedTermIds(`${sceneText}\n${sceneSummary}`, buildTermMentionMatcher([...termEntriesById.values()]))
        : new Set<string>()
    const sceneTermIds = activeScene
        ? [...new Set([...manualTermIds, ...detectedTermIds])]
        : []
    const sceneTerms = sceneTermIds
        .map((termId) => termEntriesById.get(termId))
        .filter(Boolean) as TermEntry[]
    const sceneLabels = (activeScene?.labelIds ?? [])
        .map((labelId) => labelsById.get(labelId))
        .filter(Boolean) as NovelLabel[]

    // Term picker results (non-archived, filtered by query) — mirrors the writing page.
    const normalizedTermQuery = termQuery.trim().toLocaleLowerCase()
    const termPickerResults = [...termEntriesById.values()]
        .filter((entry) => !entry.archived)
        .filter((entry) => !normalizedTermQuery || entry.title.toLocaleLowerCase().includes(normalizedTermQuery))

    const saveSceneTerms = async (termIds: string[]) => {
        if (!activeScene || isDragOverlay) return
        try {
            const updated = await sceneApi.update(activeScene.id, { termIds })
            onScenesChange(
                chapter.id,
                scenes.map((s) => (s.id === activeScene.id ? { ...s, termIds: updated.termIds } : s))
            )
        } catch (error) {
            console.error('Failed to save terms:', error)
        }
    }

    const saveSceneLabels = async (labelIds: string[]) => {
        if (!activeScene || isDragOverlay) return
        try {
            const updated = await sceneApi.update(activeScene.id, { labelIds })
            onScenesChange(
                chapter.id,
                scenes.map((s) => (s.id === activeScene.id ? { ...s, labelIds: updated.labelIds } : s))
            )
        } catch (error) {
            console.error('Failed to save labels:', error)
        }
    }

    const handleCreateScene = async () => {
        if (isDragOverlay || isCreatingScene) return
        setIsCreatingScene(true)
        try {
            const newScene = await sceneApi.create(chapter.id)
            onScenesChange(chapter.id, [...scenes, newScene])
            setActiveSceneIndex(scenes.length)
        } catch (error) {
            console.error('Failed to create scene:', error)
        } finally {
            setIsCreatingScene(false)
        }
    }

    return (
        <div className={`border rounded-lg w-56 shrink-0 ${isDragOverlay ? 'shadow-xl ring-2 ring-primary/30 bg-card' : 'bg-muted/60'
            }`}>
            {/* Chapter Header - Two Row Layout */}
            <div className="px-3 pt-3 pb-2">
                <div className="flex items-start gap-1.5">
                    {/* Drag Handle */}
                    <div className="mt-0.5 opacity-40">
                        <GripVertical className="h-4 w-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                        {/* First row: Chapter N - X words */}
                        <div className="text-xs text-muted-foreground mb-0.5">
                            {chapterLabel} {globalIndex} – {chapter.wordCount || 0} {tCommon('words')}
                        </div>
                        {/* Second row: Title */}
                        <div className="font-medium text-foreground truncate">
                            {chapter.title}
                        </div>
                    </div>

                    {/* Edit & More buttons */}
                    <div className="flex items-center gap-0.5 -mr-1">
                        <button
                            className="p-1 opacity-40 hover:opacity-100 hover:bg-muted rounded"
                            title={t('chapter.label')}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation()
                                onNavigateToWrite({ kind: 'chapter', chapterId: chapter.id })
                            }}
                        >
                            <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="p-1 opacity-40 hover:opacity-100 hover:bg-muted rounded">
                                    <MoreVertical className="h-3.5 w-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    variant={canDeleteDirectly ? 'destructive' : 'default'}
                                    className={canDeleteDirectly ? 'text-destructive' : 'text-muted-foreground'}
                                    disabled={!canDeleteDirectly}
                                    onClick={() => {
                                        if (canDeleteDirectly) {
                                            onDeleteChapter(chapter)
                                        }
                                    }}
                                >
                                    <Trash2 className="h-4 w-4 text-current" />
                                    {tCommon('delete')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </div>

            {/* Scene Section - Subtle styling */}
            <div className="mx-2 mb-2 flex h-[224px] flex-col rounded border bg-card p-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <GripVertical className="h-3 w-3 opacity-50" />
                    <span>{sceneLabel} {activeScene ? displayedSceneIndex + 1 : 1}</span>
                    <div className="ml-auto flex items-center gap-1">
                        {scenes.length > 1 && (
                            <>
                                <button
                                    type="button"
                                    className="rounded p-0.5 opacity-40 transition hover:bg-muted hover:opacity-100"
                                    onClick={() => setActiveSceneIndex(Math.max(0, displayedSceneIndex - 1))}
                                    aria-label="Previous scene"
                                >
                                    <ChevronLeft className="h-3 w-3" />
                                </button>
                                <span className="min-w-8 text-center text-[11px] text-muted-foreground">
                                    {displayedSceneIndex + 1}/{scenes.length}
                                </span>
                                <button
                                    type="button"
                                    className="rounded p-0.5 opacity-40 transition hover:bg-muted hover:opacity-100"
                                    onClick={() => setActiveSceneIndex(Math.min(scenes.length - 1, displayedSceneIndex + 1))}
                                    aria-label="Next scene"
                                >
                                    <ChevronRight className="h-3 w-3" />
                                </button>
                            </>
                        )}
                        <button
                            className="p-0.5 opacity-40 hover:opacity-100 disabled:opacity-20"
                            title={t('scene.label')}
                            disabled={!activeScene}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation()
                                if (!activeScene) return
                                onNavigateToWrite({ kind: 'scene', chapterId: chapter.id, sceneId: activeScene.id })
                            }}
                        >
                            <Edit3 className="h-3 w-3" />
                        </button>
                    </div>
                </div>
                <div
                    className={`overflow-hidden text-[11px] leading-6 ${sceneSummary ? 'text-foreground/80' : 'text-muted-foreground italic'}`}
                    style={{
                        display: '-webkit-box',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 8,
                    }}
                >
                    {sceneSummary || t('scene.addSummary')}
                </div>
            </div>

            {/* Scene Terms & Labels */}
            <div className="px-3 pb-2">
                {(sceneTerms.length > 0 || sceneLabels.length > 0) && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                        {sceneTerms.map((entry) => {
                            const colorId = getTermEntryColorId(entry.color)
                            const colorClasses = getTermEntryColorClasses(colorId)
                            // Only manually-added terms can be removed; detected ones come from the text.
                            const canRemove = !isDragOverlay && manualTermSet.has(entry.id) && !detectedTermIds.has(entry.id)
                            return (
                                <span
                                    key={entry.id}
                                    className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colorClasses.subtleBg} ${colorClasses.subtleBorder} ${colorClasses.text}`}
                                    title={entry.title}
                                >
                                    <span className="truncate">{entry.title}</span>
                                    {canRemove && (
                                        <button
                                            type="button"
                                            className="ml-1 rounded-full p-0.5 hover:bg-black/10"
                                            aria-label={tCommon('delete')}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                void saveSceneTerms(manualTermIds.filter((id) => id !== entry.id))
                                            }}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </span>
                            )
                        })}
                        {sceneLabels.map((label) => (
                            <span
                                key={label.id}
                                className="inline-flex max-w-full items-center rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-foreground"
                                title={label.name}
                            >
                                <Tag className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="truncate">{label.name}</span>
                                {!isDragOverlay && (
                                    <button
                                        type="button"
                                        className="ml-1 rounded-full p-0.5 hover:bg-black/10"
                                        aria-label={tCommon('delete')}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            void saveSceneLabels((activeScene?.labelIds ?? []).filter((id) => id !== label.id))
                                        }}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </span>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {/* Add term */}
                    <DropdownMenu
                        open={termPickerOpen}
                        onOpenChange={(open) => {
                            setTermPickerOpen(open && !!activeScene)
                            if (open) setTermQuery('')
                        }}
                    >
                        <DropdownMenuTrigger asChild>
                            <button
                                className="flex items-center gap-1 hover:text-foreground disabled:opacity-40"
                                disabled={!activeScene}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <Plus className="h-3 w-3" />
                                <span>{t('actions.term')}</span>
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-[16rem] p-0">
                            <div className="p-2">
                                <Input
                                    value={termQuery}
                                    onChange={(e) => setTermQuery(e.target.value)}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    placeholder={t('terms.search')}
                                    className="h-8 text-sm"
                                />
                            </div>
                            <DropdownMenuSeparator />
                            {termPickerResults.length === 0 ? (
                                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                    {t('terms.emptyAll')}
                                </DropdownMenuItem>
                            ) : (
                                termPickerResults.map((entry) => {
                                    const alreadyAdded = manualTermSet.has(entry.id)
                                    const detected = detectedTermIds.has(entry.id)
                                    const colorId = getTermEntryColorId(entry.color)
                                    const colorClasses = getTermEntryColorClasses(colorId)
                                    const hasCustomColor = colorId !== 'black'
                                    return (
                                        <DropdownMenuItem
                                            key={entry.id}
                                            disabled={alreadyAdded || detected}
                                            onSelect={(e) => {
                                                e.preventDefault()
                                                if (alreadyAdded || detected) return
                                                void saveSceneTerms([...manualTermIds, entry.id])
                                            }}
                                        >
                                            <span className="flex items-center gap-2 min-w-0">
                                                <span className={cn('h-2 w-2 rounded-full', colorClasses.dot)} aria-hidden="true" />
                                                <span className={cn('truncate', hasCustomColor && colorClasses.text)}>{entry.title}</span>
                                            </span>
                                        </DropdownMenuItem>
                                    )
                                })
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Add label */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                className="flex items-center gap-1 hover:text-foreground disabled:opacity-40"
                                disabled={!activeScene}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <Tag className="h-3 w-3" />
                                <span>{t('actions.labelBtn')}</span>
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-[14rem]">
                            <DropdownMenuItem onClick={onManageLabels}>{tLabels('manage')}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {labels.length === 0 ? (
                                <DropdownMenuItem disabled>{tLabels('empty')}</DropdownMenuItem>
                            ) : (
                                labels
                                    .slice()
                                    .sort((a, b) => a.sortOrder - b.sortOrder)
                                    .map((label) => (
                                        <DropdownMenuCheckboxItem
                                            key={label.id}
                                            checked={(activeScene?.labelIds ?? []).includes(label.id)}
                                            onCheckedChange={(checked) => {
                                                const current = activeScene?.labelIds ?? []
                                                const next = checked === true
                                                    ? [...current, label.id]
                                                    : current.filter((id) => id !== label.id)
                                                void saveSceneLabels(next)
                                            }}
                                            onSelect={(e) => e.preventDefault()}
                                        >
                                            <span className="flex items-center gap-2">
                                                <span
                                                    className="inline-block h-3 w-3 rounded-sm border"
                                                    style={{
                                                        backgroundColor: label.color ?? '#000000',
                                                        borderColor: label.color ?? '#000000',
                                                    }}
                                                />
                                                {label.name}
                                            </span>
                                        </DropdownMenuCheckboxItem>
                                    ))
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* New Scene Button */}
            <div className="border-t py-2 px-3">
                <button
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 disabled:opacity-40"
                    disabled={isCreatingScene}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation()
                        void handleCreateScene()
                    }}
                >
                    <Plus className="h-3 w-3" />
                    {isCreatingScene ? t('scene.creating') : t('scene.newScene')}
                </button>
            </div>
        </div>
    )
}

// Sortable Chapter Card Component
function SortableChapterCard({
    chapter,
    globalIndex,
    labels,
    labelsById,
    termEntriesById,
    onDeleteChapter,
    onScenesChange,
    onManageLabels,
    onNavigateToWrite,
    t,
    tCommon,
    tLabels,
}: {
    chapter: ChapterWithScenes
    globalIndex: number
    labels: NovelLabel[]
    labelsById: Map<string, NovelLabel>
    termEntriesById: Map<string, TermEntry>
    onDeleteChapter: (chapter: ChapterWithScenes) => void
    onScenesChange: (chapterId: string, scenes: Scene[]) => void
    onManageLabels: () => void
    onNavigateToWrite: (target: WriteNavTarget) => void
    t: (key: string) => string
    tCommon: (key: string) => string
    tLabels: (key: string) => string
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: chapter.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    // When dragging, show a placeholder with just the background color
    if (isDragging) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className="bg-primary/10 border-2 border-primary/25 border-dashed rounded-lg w-56 h-48 shrink-0"
            />
        )
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing"
        >
            <ChapterCardContent
                chapter={chapter}
                globalIndex={globalIndex}
                labels={labels}
                labelsById={labelsById}
                termEntriesById={termEntriesById}
                onDeleteChapter={onDeleteChapter}
                onScenesChange={onScenesChange}
                onManageLabels={onManageLabels}
                onNavigateToWrite={onNavigateToWrite}
                t={t}
                tCommon={tCommon}
                tLabels={tLabels}
            />
        </div>
    )
}

// Sortable Act Component - NovelCrafter Style
function SortableAct({
    actNumber,
    title,
    chapters,
    isExpanded,
    onToggle,
    onCreateChapter,
    getGlobalChapterIndex,
    totalWords,
    activeChapterId,
    activeChapterActNumber,
    overId,
    labels,
    labelsById,
    termEntriesById,
    onDeleteChapter,
    onDeleteAct,
    onScenesChange,
    onManageLabels,
    onNavigateToWrite,
    t,
    tCommon,
    tLabels,
}: {
    actNumber: number
    title: string
    chapters: ChapterWithScenes[]
    isExpanded: boolean
    onToggle: () => void
    onCreateChapter: () => void
    getGlobalChapterIndex: (chapterId: string) => number
    totalWords: number
    activeChapterId: string | null
    activeChapterActNumber: number | null
    overId: string | null
    labels: NovelLabel[]
    labelsById: Map<string, NovelLabel>
    termEntriesById: Map<string, TermEntry>
    onDeleteChapter: (chapter: ChapterWithScenes) => void
    onDeleteAct: (actNumber: number) => void
    onScenesChange: (chapterId: string, scenes: Scene[]) => void
    onManageLabels: () => void
    onNavigateToWrite: (target: WriteNavTarget) => void
    t: (key: string) => string
    tCommon: (key: string) => string
    tLabels: (key: string) => string
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: `act-${actNumber}` })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    }

    const { setNodeRef: setDropRef, isOver: isOverActDrop } = useDroppable({
        id: `act-drop-${actNumber}`,
    })

    const chapterIds = useMemo(() => chapters.map(c => c.id), [chapters])
    const overChapterIndex = overId ? chapterIds.indexOf(overId) : -1
    const isOverActHeader = overId === `act-${actNumber}`
    const isOverActDropZone = overId === `act-drop-${actNumber}` || isOverActDrop || isOverActHeader
    const showDropPlaceholder = Boolean(activeChapterId)
        && activeChapterActNumber !== null
        && activeChapterActNumber !== actNumber
        && (isOverActDropZone || overChapterIndex !== -1)
    const placeholderIndex = overChapterIndex !== -1 ? overChapterIndex : chapters.length
    const canDeleteDirectly = canDeleteActDirectly(chapters)

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`mb-6 ${isDragging ? 'ring-2 ring-primary/25 rounded-lg bg-primary/5' : ''}`}
        >
            {/* Act Header - Row 1: Drag, Chevron, Title */}
            <div className="flex items-center gap-2">
                {/* Drag Handle */}
                <button
                    {...attributes}
                    {...listeners}
                    className="cursor-grab active:cursor-grabbing opacity-30 hover:opacity-60"
                >
                    <GripVertical className="h-4 w-4" />
                </button>

                {/* Expand/Collapse Chevron */}
                <button
                    onClick={onToggle}
                    className="opacity-50 hover:opacity-100"
                >
                    {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                    ) : (
                        <ChevronRight className="h-4 w-4" />
                    )}
                </button>

                {/* Act Title - Bold */}
                <span className="font-bold text-lg text-foreground">
                    {title}
                </span>
            </div>

            {/* Act Header - Row 2: Buttons and Stats */}
            <div className="flex items-center gap-2 mt-1 ml-8 mb-3">
                {/* New Chapter Button - Outlined Style */}
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={onCreateChapter}
                >
                    <Plus className="h-3 w-3" />
                    {t('chapter.newChapter')}
                </Button>

                {/* Edit & More buttons */}
                <button
                    className="p-1.5 opacity-40 hover:opacity-100 hover:bg-muted rounded"
                    title={title}
                    onClick={() => onNavigateToWrite({ kind: 'act', actNumber })}
                >
                    <Edit3 className="h-4 w-4" />
                </button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="p-1.5 opacity-40 hover:opacity-100 hover:bg-muted rounded">
                            <MoreVertical className="h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem>{t('act.insertActBefore')}</DropdownMenuItem>
                        <DropdownMenuItem>{t('act.insertActAfter')}</DropdownMenuItem>
                        <DropdownMenuItem
                            variant={canDeleteDirectly ? 'destructive' : 'default'}
                            className={canDeleteDirectly ? 'text-destructive' : 'text-muted-foreground'}
                            disabled={!canDeleteDirectly}
                            onClick={() => {
                                if (canDeleteDirectly) {
                                    onDeleteAct(actNumber)
                                }
                            }}
                        >
                            <Trash2 className="h-4 w-4 text-current" />
                            {t('act.deleteAct')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Chapter Count & Word Count */}
                <span className="text-sm text-muted-foreground">
                    {chapters.length} {chapters.length === 1 ? t('view.chapter') : t('view.chapters')} – {totalWords.toLocaleString()} {tCommon('words')}
                </span>
            </div>

            {/* Chapters Grid - Only Shown When Expanded */}
            {isExpanded && (
                <div className="ml-8">
                    <SortableContext
                        items={chapterIds}
                        strategy={rectSortingStrategy}
                    >
                        {/* Dynamic grid: auto-fill with min 224px (w-56) cards */}
                        <div
                            ref={setDropRef}
                            className="grid gap-3 pb-4 min-h-[192px]"
                            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(224px, 1fr))' }}
                        >
                            {chapters.flatMap((chapter, idx) => {
                                const items = []
                                if (showDropPlaceholder && idx === placeholderIndex) {
                                    items.push(
                                        <div
                                            key={`drop-placeholder-${actNumber}-${idx}`}
                                            className="bg-primary/10 border-2 border-primary/25 border-dashed rounded-lg w-56 h-48 shrink-0"
                                        />
                                    )
                                }
                                items.push(
                                    <SortableChapterCard
                                        key={chapter.id}
                                        chapter={chapter}
                                        globalIndex={getGlobalChapterIndex(chapter.id)}
                                        labels={labels}
                                        labelsById={labelsById}
                                        termEntriesById={termEntriesById}
                                        onDeleteChapter={onDeleteChapter}
                                        onScenesChange={onScenesChange}
                                        onManageLabels={onManageLabels}
                                        onNavigateToWrite={onNavigateToWrite}
                                        t={t}
                                        tCommon={tCommon}
                                        tLabels={tLabels}
                                    />
                                )
                                return items
                            })}
                            {showDropPlaceholder && placeholderIndex === chapters.length && (
                                <div className="bg-primary/10 border-2 border-primary/25 border-dashed rounded-lg w-56 h-48 shrink-0" />
                            )}
                            {chapters.length === 0 && !showDropPlaceholder && (
                                <div className="text-muted-foreground italic text-sm py-8 col-span-full">
                                    {t('chapter.noChaptersYet')}
                                </div>
                            )}
                        </div>
                    </SortableContext>
                </div>
            )}
        </div>
    )
}

export function PlanView({
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
}: PlanViewProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const tLabels = useTranslations('editor.labels')
    const termEntries = useStoredTermEntries(novelId)
    const [expandedActs, setExpandedActs] = useState<Set<number>>(() => {
        // Expand all acts by default
        const acts = new Set<number>()
        chapters.forEach(c => acts.add(c.actNumber))
        emptyActs.forEach(a => acts.add(a))
        return acts
    })

    const [activeId, setActiveId] = useState<string | null>(null)
    const [overId, setOverId] = useState<string | null>(null)

    const collisionDetection = (args: Parameters<typeof closestCorners>[0]) => {
        const pointerCollisions = pointerWithin(args)
        if (pointerCollisions.length > 0) {
            return pointerCollisions
        }
        return closestCorners(args)
    }

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    const labelsById = useMemo(() => new Map(labels.map((label) => [label.id, label] as const)), [labels])
    const termEntriesById = useMemo(() => new Map(termEntries.map((entry) => [entry.id, entry] as const)), [termEntries])

    // Group chapters by act
    const chaptersByAct = useMemo(() => {
        const grouped: Record<number, ChapterWithScenes[]> = {}
        chapters.forEach(chapter => {
            if (!grouped[chapter.actNumber]) {
                grouped[chapter.actNumber] = []
            }
            grouped[chapter.actNumber].push(chapter)
        })
        // Sort chapters within each act by order
        Object.keys(grouped).forEach(actNum => {
            grouped[Number(actNum)].sort((a, b) => a.order - b.order)
        })
        return grouped
    }, [chapters])

    // Get all act numbers (including empty acts)
    const actNumbers = useMemo(() => {
        const nums = new Set<number>()
        chapters.forEach(c => nums.add(c.actNumber))
        emptyActs.forEach(a => nums.add(a))
        actsFromDb.forEach(a => nums.add(a.number))
        return Array.from(nums).sort((a, b) => a - b)
    }, [chapters, emptyActs, actsFromDb])

    // Calculate word count per act
    const actWordCounts = useMemo(() => {
        const counts: Record<number, number> = {}
        actNumbers.forEach(actNum => {
            counts[actNum] = (chaptersByAct[actNum] || []).reduce(
                (sum, ch) => sum + (ch.wordCount || 0),
                0
            )
        })
        return counts
    }, [actNumbers, chaptersByAct])

    const toggleAct = (actNumber: number) => {
        setExpandedActs(prev => {
            const next = new Set(prev)
            if (next.has(actNumber)) {
                next.delete(actNumber)
            } else {
                next.add(actNumber)
            }
            return next
        })
    }

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string)
    }

    const handleDragOver = (event: DragOverEvent) => {
        setOverId(event.over?.id ? (event.over.id as string) : null)
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        setActiveId(null)
        setOverId(null)

        if (!over || active.id === over.id) return

        const activeIdStr = active.id as string
        const overIdStr = over.id as string

        // Check if we're dragging an act
        if (activeIdStr.startsWith('act-') && (overIdStr.startsWith('act-') || overIdStr.startsWith('act-drop-'))) {
            const activeActNumber = Number(activeIdStr.replace('act-', ''))
            const overActNumber = Number(overIdStr.replace('act-drop-', '').replace('act-', ''))
            if (!Number.isNaN(activeActNumber) && !Number.isNaN(overActNumber)) {
                const activeIndex = actNumbers.indexOf(activeActNumber)
                const overIndex = actNumbers.indexOf(overActNumber)
                if (activeIndex !== -1 && overIndex !== -1) {
                    const nextActNumbers = arrayMove(actNumbers, activeIndex, overIndex)
                    const actNumberMap = new Map<number, number>()
                    nextActNumbers.forEach((oldNumber, index) => {
                        actNumberMap.set(oldNumber, index + 1)
                    })
                    setExpandedActs(prev => {
                        const next = new Set<number>()
                        prev.forEach(actNumber => {
                            next.add(actNumberMap.get(actNumber) || actNumber)
                        })
                        return next
                    })
                }
                await onReorderActs(activeActNumber, overActNumber)
            }
            return
        }

        // Chapter reordering within the same act
        const activeChapter = chapters.find(c => c.id === activeIdStr)
        const overChapter = chapters.find(c => c.id === overIdStr)
        const overActMatch = overIdStr.match(/^act-(\d+)$/)
        const overActDropMatch = overIdStr.match(/^act-drop-(\d+)$/)

        if (!activeChapter) return

        if (overChapter) {
            if (activeChapter.actNumber === overChapter.actNumber) {
                // Same act - reorder
                const actChapters = chaptersByAct[activeChapter.actNumber] || []
                const oldIndex = actChapters.findIndex(c => c.id === activeIdStr)
                const newIndex = actChapters.findIndex(c => c.id === overIdStr)

                if (oldIndex !== -1 && newIndex !== -1) {
                    const reordered = arrayMove(actChapters, oldIndex, newIndex)
                    const updates = reordered.map((ch, idx) => ({
                        id: ch.id,
                        order: idx,
                        actNumber: ch.actNumber,
                    }))
                    await onReorderChapters(updates)
                }
                return
            }

            // Different act - move chapter to another act
            const targetActChapters = chaptersByAct[overChapter.actNumber] || []
            const targetIndex = targetActChapters.findIndex(c => c.id === overIdStr)
            const insertIndex = targetIndex === -1 ? targetActChapters.length : targetIndex

            // Update the moved chapter's actNumber and order
            const updates = [
                {
                    id: activeChapter.id,
                    order: insertIndex,
                    actNumber: overChapter.actNumber,
                },
            ]

            // Shift orders of chapters after the insertion point
            targetActChapters.forEach((ch, idx) => {
                if (idx >= insertIndex) {
                    updates.push({
                        id: ch.id,
                        order: idx + 1,
                        actNumber: ch.actNumber,
                    })
                }
            })

            // Update source act chapter orders
            const sourceActChapters = (chaptersByAct[activeChapter.actNumber] || [])
                .filter(c => c.id !== activeChapter.id)
            sourceActChapters.forEach((ch, idx) => {
                updates.push({
                    id: ch.id,
                    order: idx,
                    actNumber: ch.actNumber,
                })
            })

            await onReorderChapters(updates)
            return
        }

        if (overActMatch || overActDropMatch) {
            const targetActNumber = Number((overActMatch || overActDropMatch)![1])
            if (Number.isNaN(targetActNumber) || targetActNumber === activeChapter.actNumber) {
                return
            }

            const targetActChapters = chaptersByAct[targetActNumber] || []
            const updates = [
                {
                    id: activeChapter.id,
                    order: targetActChapters.length,
                    actNumber: targetActNumber,
                },
            ]

            targetActChapters.forEach((ch, idx) => {
                updates.push({
                    id: ch.id,
                    order: idx,
                    actNumber: ch.actNumber,
                })
            })

            const sourceActChapters = (chaptersByAct[activeChapter.actNumber] || [])
                .filter(c => c.id !== activeChapter.id)
            sourceActChapters.forEach((ch, idx) => {
                updates.push({
                    id: ch.id,
                    order: idx,
                    actNumber: ch.actNumber,
                })
            })

            await onReorderChapters(updates)
        }
    }

    const actIds = useMemo(() => actNumbers.map(n => `act-${n}`), [actNumbers])

    // Find the active chapter for drag overlay
    const activeChapter = activeId && !activeId.startsWith('act-')
        ? chapters.find(c => c.id === activeId)
        : null
    const activeChapterActNumber = activeChapter ? activeChapter.actNumber : null
    const dragOverlay = activeChapter ? (
        <ChapterCardContent
            chapter={activeChapter}
            globalIndex={getGlobalChapterIndex(activeChapter.id)}
            labels={labels}
            labelsById={labelsById}
            termEntriesById={termEntriesById}
            onDeleteChapter={onDeleteChapter}
            onScenesChange={onScenesChange}
            onManageLabels={onManageLabels}
            onNavigateToWrite={onNavigateToWrite}
            isDragOverlay={true}
            t={t}
            tCommon={tCommon}
            tLabels={tLabels}
        />
    ) : null

    return (
        <div className="p-6 pt-4">
            <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDragCancel={() => {
                    setActiveId(null)
                    setOverId(null)
                }}
            >
                <SortableContext
                    items={actIds}
                    strategy={verticalListSortingStrategy}
                >
                    {actNumbers.map(actNum => (
                        <SortableAct
                            key={actNum}
                            actNumber={actNum}
                            title={getActDisplayTitle(actNum)}
                            chapters={chaptersByAct[actNum] || []}
                            isExpanded={expandedActs.has(actNum)}
                            onToggle={() => toggleAct(actNum)}
                            onCreateChapter={() => onCreateChapter(actNum)}
                            getGlobalChapterIndex={getGlobalChapterIndex}
                            totalWords={actWordCounts[actNum] || 0}
                            activeChapterId={activeChapter ? activeChapter.id : null}
                            activeChapterActNumber={activeChapterActNumber}
                            overId={overId}
                            labels={labels}
                            labelsById={labelsById}
                            termEntriesById={termEntriesById}
                            onDeleteChapter={onDeleteChapter}
                            onDeleteAct={onDeleteAct}
                            onScenesChange={onScenesChange}
                            onManageLabels={onManageLabels}
                            onNavigateToWrite={onNavigateToWrite}
                            t={t}
                            tCommon={tCommon}
                            tLabels={tLabels}
                        />
                    ))}
                </SortableContext>

                {/* Drag Overlay - Full card preview that follows mouse */}
                {typeof document !== 'undefined' && createPortal(
                    <DragOverlay dropAnimation={null} style={{ zIndex: 1000 }}>
                        {dragOverlay}
                    </DragOverlay>,
                    document.body
                )}
            </DndContext>

            {/* Add New Act Button */}
            <div className="mt-6 pt-4 border-t border-dashed">
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={onCreateAct}
                >
                    <Plus className="h-4 w-4" />
                    {t('act.newAct')}
                </Button>
            </div>
        </div>
    )
}
