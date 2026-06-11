'use client'

import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Plus,
    ClipboardList,
    FileText,
    MoreVertical,
    Trash2,
    Minimize2,
    Tag,
    X,
} from 'lucide-react'
import { ChapterSceneEditor } from '@/components/editor/chapter-scene-editor'
import { Chapter, ChapterWithScenes, NovelLabel, Scene } from '@/lib/api'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import { buildTermMentionMatcher } from '@/components/editor/terms/term-mentions-utils'
import { TermMentionsHighlightTextarea } from '@/components/editor/terms/term-mentions-highlight-textarea'
import { TermMentionPreviewPopover } from '@/components/editor/terms/term-mention-preview-popover'
import { canDeleteActDirectly, canDeleteChapterDirectly } from '@/lib/manuscript-delete-rules'
import { WRITE_FONT_FAMILY_STACK, useWriteFormatStore, type WriteLineHeight, type WriteParagraphSpacing, type WriteTextIndent, type WriteTextSize } from '@/components/editor/write-format-store'

type ViewFilter = 'everything' | 'act' | 'chapter'

interface MiddlePanelWriteProps {
    novelId?: string
    focusMode: boolean
    viewFilter: ViewFilter
    selectedActNumber: number | null
    selectedChapterId: string | null
    labels: NovelLabel[]
    onManageLabels: () => void
    chapters: ChapterWithScenes[]
    chaptersByAct: Record<number, ChapterWithScenes[]>
    actNumbers: number[]
    emptyActs: Set<number>
    actTitles: Record<number, string>
    actSummaries: Record<number, string>
    actLabelIds: Record<number, string[]>
    editingChapterId: string | null
    editingTitle: string
    editingActNumber: number | null
    editingActTitle: string
    editingActSummaryNumber: number | null
    editingActSummary: string
    // Callbacks
    onExitFocusMode: () => void
    onOpenRightSidebar?: () => void
    onScenesChange: (chapterId: string, scenes: Scene[]) => void
    onUpdateChapterTitle: (chapterId: string, newTitle: string) => void
    onUpdateActTitle: (actNumber: number, newTitle: string) => void
    onUpdateActSummary: (actNumber: number, newSummary: string) => void
    onUpdateActLabels: (actNumber: number, labelIds: string[]) => void
    onOpenOutlineForAct: (actNumber: number) => void
    onOpenOutlineForChapter: (chapterId: string) => void
    onInsertChapter: (chapter: Chapter, position: 'before' | 'after') => void
    onInsertAct: (actNumber: number, position: 'before' | 'after') => void
    onDeleteChapter: (chapter: Chapter) => void
    onDeleteAct: (actNumber: number) => void
    onCreateChapter: (actNumber: number) => void
    onCreateAct: () => void
    // State setters for editing
    setEditingChapterId: (id: string | null) => void
    setEditingTitle: (title: string) => void
    setEditingActNumber: (num: number | null) => void
    setEditingActTitle: (title: string) => void
    setEditingActSummaryNumber: (num: number | null) => void
    setEditingActSummary: (summary: string) => void
    // Helpers
    getGlobalChapterIndex: (chapterId: string) => number
    getActDisplayIndex: (actNumber: number) => number
    getActDisplayTitle: (actNumber: number) => string
    isDefaultChapterTitle: (title: string) => boolean
    isDefaultActTitle: (actNumber: number) => boolean
}

export function MiddlePanelWrite({
    novelId,
    focusMode,
    viewFilter,
    selectedActNumber,
    selectedChapterId,
    labels,
    onManageLabels,
    chapters,
    chaptersByAct,
    actNumbers,
    emptyActs,
    actTitles,
    actSummaries,
    actLabelIds,
    editingChapterId,
    editingTitle,
    editingActNumber,
    editingActTitle,
    editingActSummaryNumber,
    editingActSummary,
    onExitFocusMode,
    onOpenRightSidebar,
    onScenesChange,
    onUpdateChapterTitle,
    onUpdateActTitle,
    onUpdateActSummary,
    onUpdateActLabels,
    onOpenOutlineForAct,
    onOpenOutlineForChapter,
    onInsertChapter,
    onInsertAct,
    onDeleteChapter,
    onDeleteAct,
    onCreateChapter,
    onCreateAct,
    setEditingChapterId,
    setEditingTitle,
    setEditingActNumber,
    setEditingActTitle,
    setEditingActSummaryNumber,
    setEditingActSummary,
    getGlobalChapterIndex,
    getActDisplayIndex,
    getActDisplayTitle,
    isDefaultChapterTitle,
    isDefaultActTitle,
}: MiddlePanelWriteProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const tLabels = useTranslations('editor.labels')
    const { fontFamily, lineHeight, paragraphSpacing, textIndent, textSize } = useWriteFormatStore()

    const writeFormatStyle = useMemo(() => {
        const textSizeMap: Record<WriteTextSize, string> = {
            sm: '0.95rem',
            md: '1rem',
            lg: '1.125rem',
            xl: '1.25rem',
        }

        const lineHeightMap: Record<WriteLineHeight, string> = {
            tight: '1.45',
            normal: '1.75',
            relaxed: '1.95',
            loose: '2.15',
        }

        const paragraphSpacingMap: Record<WriteParagraphSpacing, string> = {
            none: '0',
            sm: '0.5em',
            md: '1em',
            lg: '1.5em',
        }

        const textIndentMap: Record<WriteTextIndent, string> = {
            none: '0',
            sm: '1em',
            md: '2em',
        }

        return {
            ['--onw-write-font-family' as unknown as keyof CSSProperties]: WRITE_FONT_FAMILY_STACK[fontFamily] ?? WRITE_FONT_FAMILY_STACK.sans,
            ['--onw-write-font-size' as unknown as keyof CSSProperties]: textSizeMap[textSize],
            ['--onw-write-line-height' as unknown as keyof CSSProperties]: lineHeightMap[lineHeight],
            ['--onw-write-paragraph-spacing' as unknown as keyof CSSProperties]: paragraphSpacingMap[paragraphSpacing],
            ['--onw-write-text-indent' as unknown as keyof CSSProperties]: textIndentMap[textIndent],
        } as CSSProperties
    }, [fontFamily, lineHeight, paragraphSpacing, textIndent, textSize])
    const termEntries = useStoredTermEntries(novelId)
    const termMentionMatcher = useMemo(() => buildTermMentionMatcher(termEntries), [termEntries])
    const termEntriesById = useMemo(() => new Map(termEntries.map((entry) => [entry.id, entry])), [termEntries])
    const labelsById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels])

    const [summaryMentionPreview, setSummaryMentionPreview] = useState<{ termId: string; anchorEl: HTMLElement } | null>(null)
    const handleSummaryTermMentionClick = useCallback((termId: string, anchorEl: HTMLElement) => {
        setSummaryMentionPreview((prev) => {
            if (prev?.termId === termId && prev.anchorEl === anchorEl) return null
            return { termId, anchorEl }
        })
    }, [])

    const summaryMentionPreviewEntry = useMemo(() => {
        if (!summaryMentionPreview) return null
        return termEntriesById.get(summaryMentionPreview.termId) ?? null
    }, [summaryMentionPreview, termEntriesById])

    // Chapter content rendering for a single chapter
    const renderChapterContent = (chapter: ChapterWithScenes) => {
        const canDeleteDirectly = canDeleteChapterDirectly(chapter)

        return (
        <div key={chapter.id} id={`chapter-${chapter.id}`} className="mb-16">
            {/* Chapter header row with aligned Actions */}
            <div className="flex gap-6 mb-1 pr-2">
                {/* Left: Chapter index */}
                <div className="flex-1 min-w-0 pl-2">
                    <div className="text-base text-muted-foreground">
                        {t('chapter.label')} {getGlobalChapterIndex(chapter.id)}
                    </div>
                </div>
                {/* Right: Actions button - aligned with scene info panel */}
                <div className="w-56 shrink-0">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded focus:outline-none data-[state=open]:bg-black data-[state=open]:text-white">
                                <MoreVertical className="h-3 w-3" />
                                {t('actions.label')}
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => onOpenOutlineForChapter(chapter.id)}>
                                <ClipboardList className="h-4 w-4 mr-2" />
                                {t('outlines.action')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onInsertChapter(chapter, 'before')}>{t('chapter.insertBefore')}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onInsertChapter(chapter, 'after')}>{t('chapter.insertAfter')}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem>{t('chapter.copyBeats')}</DropdownMenuItem>
                            <DropdownMenuItem>{t('chapter.copyProse')}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                variant={canDeleteDirectly ? 'destructive' : 'default'}
                                className={canDeleteDirectly ? 'text-destructive' : 'text-muted-foreground'}
                                disabled={!canDeleteDirectly}
                                onClick={() => {
                                    if (canDeleteDirectly) {
                                        void onDeleteChapter(chapter)
                                    }
                                }}
                            >
                                <Trash2 className="h-4 w-4 mr-2" />
                                {tCommon('delete')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            {/* Two-column layout: content left, info panel right */}
            <div className="flex gap-8">
                {/* Left column: Editor content */}
                <div className="flex-1 min-w-0">
                    {/* Chapter header - slightly indented */}
                    <div className="mb-4 pl-2">
                        <input
                            type="text"
                            value={editingChapterId === chapter.id ? editingTitle : chapter.title}
                            onChange={(e) => {
                                if (editingChapterId === chapter.id) {
                                    setEditingTitle(e.target.value)
                                }
                            }}
                            onFocus={() => {
                                setEditingChapterId(chapter.id)
                                setEditingTitle(isDefaultChapterTitle(chapter.title) ? '' : chapter.title)
                            }}
                            onBlur={() => {
                                if (editingChapterId === chapter.id) {
                                    onUpdateChapterTitle(chapter.id, editingTitle)
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    onUpdateChapterTitle(chapter.id, editingTitle)
                                        ; (e.target as HTMLInputElement).blur()
                                } else if (e.key === 'Escape') {
                                    setEditingChapterId(null)
                                        ; (e.target as HTMLInputElement).blur()
                                }
                            }}
                            placeholder={chapter.title || t('chapter.untitledChapter')}
                            className={`text-3xl font-bold bg-transparent rounded px-2 py-1 -ml-2 outline-none w-full max-w-md cursor-text
                                ${editingChapterId === chapter.id
                                    ? 'ring-2 ring-gray-300 bg-gray-50/50'
                                    : 'hover:bg-muted/30'}
                                placeholder:text-gray-400`}
                        />
                    </div>

                    {/* Scene Editor - handles multiple scenes with dividers */}
                    <ChapterSceneEditor
                        novelId={novelId}
                        chapterId={chapter.id}
                        scenes={chapter.scenes || []}
                        onScenesChange={(scenes) => onScenesChange(chapter.id, scenes)}
                        globalChapterIndex={getGlobalChapterIndex(chapter.id)}
                        chapterTitle={chapter.title}
                        termMentionMatcher={termMentionMatcher}
                        termEntries={termEntries}
                        labels={labels}
                        onManageLabels={onManageLabels}
                        onOpenRightSidebar={onOpenRightSidebar}
                    />
                </div>
            </div>
        </div>
        )
    }

    // Act header rendering
    const renderActHeader = (actNum: number, actChapters: ChapterWithScenes[]) => {
        const canDeleteDirectly = canDeleteActDirectly(actChapters)

        return (
        <div className="flex gap-6 mb-6 pb-4 border-b border-dashed pr-2">
            {/* Left: Act info - centered content */}
            <div className="flex-1 min-w-0 flex flex-col items-center">
                {/* Act number label */}
                <div className="text-base text-muted-foreground">
                    {t('act.label')} {getActDisplayIndex(actNum)}
                </div>
                {/* Act title */}
                <input
                    type="text"
                    value={editingActNumber === actNum ? editingActTitle : (actTitles[actNum] || getActDisplayTitle(actNum))}
                    onChange={(e) => {
                        if (editingActNumber === actNum) {
                            setEditingActTitle(e.target.value)
                        }
                    }}
                    onFocus={() => {
                        setEditingActNumber(actNum)
                        setEditingActTitle(isDefaultActTitle(actNum) ? '' : actTitles[actNum])
                    }}
                    onBlur={() => {
                        if (editingActNumber === actNum) {
                            onUpdateActTitle(actNum, editingActTitle)
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            onUpdateActTitle(actNum, editingActTitle)
                                ; (e.target as HTMLInputElement).blur()
                        } else if (e.key === 'Escape') {
                            setEditingActNumber(null)
                                ; (e.target as HTMLInputElement).blur()
                        }
                    }}
                    placeholder={getActDisplayTitle(actNum)}
                    className={`text-xl font-semibold text-center bg-transparent rounded px-4 py-1 outline-none max-w-xs cursor-text
                        ${editingActNumber === actNum
                            ? 'ring-2 ring-gray-300 bg-gray-50/50'
                            : 'hover:bg-muted/30'}
                        placeholder:text-gray-400`}
                />
            </div>
            {/* Right: Act info panel - with group hover effect */}
            <div className="w-56 shrink-0 text-xs space-y-2 pt-1 group text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                {/* Act stats */}
                <div className="font-medium group-hover:text-foreground transition-colors">
                    {t('act.label')} {getActDisplayIndex(actNum)}{actTitles[actNum] ? `: ${actTitles[actNum]}` : ''}
                    <span className="font-normal ml-2">
                        – {actChapters.length} {actChapters.length === 1 ? t('view.chapter') : t('view.chapters')}, {actChapters.reduce((sum, c) => sum + c.wordCount, 0)} {tCommon('words')}
                    </span>
                </div>
                {/* Summary */}
                <TermMentionsHighlightTextarea
                    value={editingActSummaryNumber === actNum ? editingActSummary : (actSummaries[actNum] || '')}
                    onTermMentionClick={handleSummaryTermMentionClick}
                    onChange={(e) => {
                        if (editingActSummaryNumber === actNum) {
                            setEditingActSummary(e.target.value)
                        }
                    }}
                    onFocus={() => {
                        setEditingActSummaryNumber(actNum)
                        setEditingActSummary(actSummaries[actNum] || '')
                    }}
                    onBlur={() => {
                        if (editingActSummaryNumber === actNum) {
                            onUpdateActSummary(actNum, editingActSummary)
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault()
                            onUpdateActSummary(actNum, editingActSummary)
                                ; (e.target as HTMLTextAreaElement).blur()
                        }
                        if (e.key === 'Escape') {
                            setEditingActSummaryNumber(null)
                                ; (e.target as HTMLTextAreaElement).blur()
                        }
                    }}
                    placeholder={t('act.addSummary')}
                    matcher={termMentionMatcher}
                    containerClassName={`rounded transition-colors ${editingActSummaryNumber === actNum ? 'bg-gray-50/50 text-foreground' : 'group-hover:bg-muted/30'}`}
                    className="w-full text-xs border-transparent rounded px-2 py-1 resize-none outline-none cursor-text placeholder:text-muted-foreground/60"
                    rows={2}
                />

                {/* Labels */}
                {(actLabelIds[actNum]?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1 px-1">
                        {(actLabelIds[actNum] ?? [])
                            .map((labelId) => labelsById.get(labelId))
                            .filter(Boolean)
                            .map((label) => (
                                <Badge
                                    key={label!.id}
                                    className="text-white border pr-1 gap-1 hover:opacity-90 transition-opacity"
                                    style={{
                                        backgroundColor: label!.color ?? '#000000',
                                        borderColor: label!.color ?? '#000000',
                                    }}
                                >
                                    <span className="leading-none">{label!.name}</span>
                                    <button
                                        type="button"
                                        className="rounded-full p-0.5 hover:bg-white/20"
                                        onClick={() => onUpdateActLabels(actNum, (actLabelIds[actNum] ?? []).filter((id) => id !== label!.id))}
                                        aria-label={tCommon('delete')}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            ))}
                    </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-4">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1 group-hover:hover:text-foreground px-2 py-1 rounded focus:outline-none data-[state=open]:bg-black data-[state=open]:text-white">
                                <MoreVertical className="h-3 w-3" />
                                {t('actions.label')}
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => onOpenOutlineForAct(actNum)}>
                                <ClipboardList className="h-4 w-4 mr-2" />
                                {t('outlines.action')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onInsertAct(actNum, 'before')}>{t('act.insertActBefore')}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onInsertAct(actNum, 'after')}>{t('act.insertActAfter')}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                variant={canDeleteDirectly ? 'destructive' : 'default'}
                                className={canDeleteDirectly ? 'text-destructive' : 'text-muted-foreground'}
                                disabled={!canDeleteDirectly}
                                onClick={() => {
                                    if (canDeleteDirectly) {
                                        onDeleteAct(actNum)
                                    }
                                }}
                            >
                                <Trash2 className="h-4 w-4 mr-2" />
                                {t('act.deleteAct')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1 group-hover:hover:text-foreground px-2 py-1 rounded focus:outline-none data-[state=open]:bg-black data-[state=open]:text-white">
                                <Tag className="h-3 w-3" />
                                {t('actions.labelBtn')}
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
                                            checked={(actLabelIds[actNum] ?? []).includes(label.id)}
                                            onCheckedChange={(checked) => {
                                                const isChecked = checked === true
                                                const current = actLabelIds[actNum] ?? []
                                                const next = isChecked
                                                    ? [...current, label.id]
                                                    : current.filter((id) => id !== label.id)
                                                onUpdateActLabels(actNum, next)
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
                    <button className="flex items-center gap-1 group-hover:hover:text-foreground">
                        <Plus className="h-3 w-3" />
                        {t('actions.term')}
                    </button>
                </div>
            </div>
        </div>
        )
    }

    return (
        <div
            className={`${focusMode ? 'mx-auto max-w-2xl pt-16 px-8' : 'flex-1 pl-5 pr-2'} py-8 onw-middle-panel-write`}
            style={writeFormatStyle}
        >
            {/* Focus mode exit button */}
            {focusMode && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-4 right-4 z-10"
                    onClick={onExitFocusMode}
                    title={t('header.exitFocus')}
                >
                    <Minimize2 className="h-5 w-5" />
                </Button>
            )}

            {/* Chapter focus view */}
            {viewFilter === 'chapter' && selectedChapterId ? (() => {
                const chapter = chapters.find(c => c.id === selectedChapterId)
                if (!chapter) return null
                return renderChapterContent(chapter)
            })() : viewFilter === 'act' && selectedActNumber ? (
                /* Act focus view */
                <div>
                    {/* Act Header - NovelCrafter style with centered title and aligned Actions */}
                    {renderActHeader(selectedActNumber, chaptersByAct[selectedActNumber] || [])}

                    {/* Chapters in this act (if any) */}
                    {(chaptersByAct[selectedActNumber] || []).map((chapter) => renderChapterContent(chapter))}

                    {/* New Chapter button - always shown at end of act */}
                    <div className="flex justify-start mb-8">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground gap-1"
                            onClick={() => onCreateChapter(selectedActNumber)}
                        >
                            <Plus className="h-4 w-4" />
                            {t('chapter.newChapter')}
                        </Button>
                    </div>

                    {/* New Act button */}
                    <div className="flex justify-center mb-16">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground gap-1"
                            onClick={() => selectedActNumber && onInsertAct(selectedActNumber, 'after')}
                        >
                            <Plus className="h-4 w-4" />
                            {t('act.newAct')}
                        </Button>
                    </div>
                </div>
            ) : actNumbers.length > 0 || emptyActs.size > 0 ? (
                /* Everything view: show all acts */
                <>
                    {actNumbers.map((actNum) => {
                        const actChapters = chaptersByAct[actNum] || []
                        return (
                            <div key={actNum}>
                                {/* Act Header - NovelCrafter style with aligned Actions */}
                                {renderActHeader(actNum, actChapters)}

                                {actChapters.map((chapter) => renderChapterContent(chapter))}

                                {/* New Chapter button at end of each act */}
                                <div className="flex justify-start mb-8">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-muted-foreground gap-1"
                                        onClick={() => onCreateChapter(actNum)}
                                    >
                                        <Plus className="h-4 w-4" />
                                        {t('chapter.newChapter')}
                                    </Button>
                                </div>
                            </div>
                        )
                    })}

                    {/* New Act button at the very end */}
                    <div className="flex justify-center mb-16">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground gap-1"
                            onClick={onCreateAct}
                        >
                            <Plus className="h-4 w-4" />
                            {t('act.newAct')}
                        </Button>
                    </div>
                </>
            ) : (
                /* No acts/chapters at all */
                <div className="h-full flex items-center justify-center text-muted-foreground min-h-[400px]">
                    <div className="text-center">
                        <FileText className="h-16 w-16 mx-auto mb-4 opacity-50" />
                        <p>{t('sidebar.startWriting')}</p>
                        <Button className="mt-4" onClick={() => onCreateChapter(1)}>
                            <Plus className="h-4 w-4 mr-2" />
                            {t('chapter.createFirstChapter')}
                        </Button>
                    </div>
                </div>
            )}

            <TermMentionPreviewPopover
                novelId={novelId}
                open={Boolean(summaryMentionPreview && summaryMentionPreviewEntry)}
                anchorEl={summaryMentionPreview?.anchorEl ?? null}
                entry={summaryMentionPreviewEntry}
                onClose={() => setSummaryMentionPreview(null)}
            />
        </div>
    )
}
