'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocale, useTranslations } from 'next-intl'
import { outlineApi, type ChapterWithScenes, type Outline, type OutlineCreatePayload, type OutlineSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { htmlToText } from '@/lib/html-to-text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { TipTapEditor } from '@/components/editor/tiptap-editor'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import { buildTermMentionMatcher } from '@/components/editor/terms/term-mentions-utils'
import { TermMentionPreviewPopover } from '@/components/editor/terms/term-mention-preview-popover'
import type { AnchorRect } from '@/components/editor/terms/types'
import { countWords, getAnchorRect } from '@/components/editor/terms/utils'
import { RevisionHistoryDialog } from '@/components/editor/history/revision-history-dialog'
import {
    NOVEL_REFRESH_REQUESTED_EVENT,
    type NovelRefreshRequestedEventDetail,
} from '@/lib/novel-refresh-events'
import { ChevronDown, ChevronRight, ClipboardList, Copy, History, Loader2, Search, Trash2, X } from 'lucide-react'

type OutlineTarget =
    | { kind: 'act'; actNumber: number }
    | { kind: 'chapter'; chapterId: string }

interface LeftPanelChapterOutlineProps {
    novelId?: string
    isCompact: boolean
    chapters: ChapterWithScenes[]
    actNumbers: number[]
    expandedActs: Set<number>
    chaptersByAct: Record<number, ChapterWithScenes[]>
    onToggleAct: (actNumber: number) => void
    getActDisplayTitle: (actNumber: number) => string
    getGlobalChapterIndex: (chapterId: string) => number
    requestedOpenOutlineTarget?: OutlineTarget | null
    onRequestedOpenOutlineHandled?: () => void
}

export function LeftPanelChapterOutline({
    novelId,
    isCompact,
    chapters,
    actNumbers,
    expandedActs,
    chaptersByAct,
    onToggleAct,
    getActDisplayTitle,
    getGlobalChapterIndex,
    requestedOpenOutlineTarget,
    onRequestedOpenOutlineHandled,
}: LeftPanelChapterOutlineProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const locale = useLocale()

    const rootRef = useRef<HTMLDivElement | null>(null)
    const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null)

    const [outlines, setOutlines] = useState<OutlineSummary[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [searchQuery, setSearchQuery] = useState('')
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const isSearching = normalizedQuery.length > 0

    const [openOutlineId, setOpenOutlineId] = useState<string | null>(null)
    const openOutlineIdRef = useRef<string | null>(null)
    openOutlineIdRef.current = openOutlineId

    const openOutlineFromList = useMemo(
        () => outlines.find((outline) => outline.id === openOutlineId) ?? null,
        [openOutlineId, outlines]
    )

    const [openOutlineDetails, setOpenOutlineDetails] = useState<Outline | null>(null)
    const [detailsLoading, setDetailsLoading] = useState(false)

    const openOutlineSummary = useMemo(() => {
        if (openOutlineDetails && openOutlineDetails.id === openOutlineId) return openOutlineDetails
        return openOutlineFromList
    }, [openOutlineDetails, openOutlineFromList, openOutlineId])

    const [draftContent, setDraftContent] = useState('')
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [copied, setCopied] = useState(false)
    const copyTimerRef = useRef<NodeJS.Timeout | null>(null)

    const termEntries = useStoredTermEntries(novelId)
    const termMentionMatcher = useMemo(() => buildTermMentionMatcher(termEntries), [termEntries])
    const termEntriesById = useMemo(() => new Map(termEntries.map((entry) => [entry.id, entry] as const)), [termEntries])
    const [mentionPreview, setMentionPreview] = useState<{ termId: string; anchorEl: HTMLElement } | null>(null)
    const handleTermMentionClick = useCallback((termId: string, anchorEl: HTMLElement) => {
        setMentionPreview((prev) => {
            if (prev?.termId === termId && prev.anchorEl === anchorEl) return null
            return { termId, anchorEl }
        })
    }, [])
    const mentionPreviewEntry = useMemo(() => {
        if (!mentionPreview) return null
        return termEntriesById.get(mentionPreview.termId) ?? null
    }, [mentionPreview, termEntriesById])

    const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
    const pendingUpdatesRef = useRef<Partial<Pick<Outline, 'content'>> | null>(null)

    const historyItems = openOutlineDetails?.history ?? []
    const draftPlainText = useMemo(
        () => htmlToText(draftContent, { paragraphSeparator: '\n' }).trim(),
        [draftContent]
    )
    const draftWordCount = useMemo(() => countWords(draftPlainText), [draftPlainText])

    const titleForOutline = useMemo(() => {
        if (!openOutlineSummary) return ''
        if (openOutlineSummary.type === 'ACT') {
            const actNumber = openOutlineSummary.actNumber ?? 1
            return getActDisplayTitle(actNumber)
        }
        const chapterId = openOutlineSummary.chapterId
        const chapter = chapterId ? chapters.find((c) => c.id === chapterId) : null
        return chapter?.title ?? ''
    }, [chapters, getActDisplayTitle, openOutlineSummary])

    const dateFormatter = useMemo(() => {
        try {
            return new Intl.DateTimeFormat(locale ? [locale, 'zh-Hans', 'zh', 'en'] : undefined, {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
            })
        } catch {
            return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
        }
    }, [locale])

    useLayoutEffect(() => {
        const root = rootRef.current
        const aside = root?.closest('aside') as HTMLElement | null
        if (!aside) return

        const update = () => setAnchorRect(getAnchorRect(aside))
        update()

        const ro = new ResizeObserver(update)
        ro.observe(aside)
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)

        return () => {
            ro.disconnect()
            window.removeEventListener('resize', update)
            window.removeEventListener('scroll', update, true)
        }
    }, [])

    const reloadOutlines = useCallback(async () => {
        if (!novelId) return
        setLoading(true)
        setError(null)
        try {
            const items = await outlineApi.list(novelId)
            setOutlines(items)
        } catch (e) {
            console.error('Failed to load outlines:', e)
            setError(tCommon('operationFailed'))
        } finally {
            setLoading(false)
        }
    }, [novelId, tCommon])

    useEffect(() => {
        if (!novelId) return
        reloadOutlines()
    }, [novelId, reloadOutlines])

    useEffect(() => {
        if (!novelId) return
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<NovelRefreshRequestedEventDetail>).detail
            if (!detail || detail.novelId !== novelId) return
            void reloadOutlines()
        }

        window.addEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handler as EventListener)
        return () => window.removeEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handler as EventListener)
    }, [novelId, reloadOutlines])

    useEffect(() => {
        if (!openOutlineId) {
            setOpenOutlineDetails(null)
            setDetailsLoading(false)
            return
        }

        let canceled = false
        setDetailsLoading(true)
        outlineApi.get(openOutlineId)
            .then((detail) => {
                if (canceled) return
                setOpenOutlineDetails(detail)
            })
            .catch((e) => {
                console.error('Failed to load outline details:', e)
                if (canceled) return
                setOpenOutlineDetails(null)
            })
            .finally(() => {
                if (canceled) return
                setDetailsLoading(false)
            })

        return () => {
            canceled = true
        }
    }, [openOutlineId])

    useEffect(() => {
        if (!openOutlineDetails || openOutlineDetails.id !== openOutlineId) return
        setDraftContent(openOutlineDetails.content ?? '')
        setHistoryOpen(false)
        setCopied(false)
        setMentionPreview(null)
        if (copyTimerRef.current) {
            clearTimeout(copyTimerRef.current)
            copyTimerRef.current = null
        }
        pendingUpdatesRef.current = null
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
                saveTimerRef.current = null
            }
    }, [openOutlineDetails?.id, openOutlineId]) // eslint-disable-line react-hooks/exhaustive-deps

    const flushPendingSave = useCallback(async () => {
        const outlineId = openOutlineIdRef.current
        const updates = pendingUpdatesRef.current
        pendingUpdatesRef.current = null
        if (!outlineId || !updates || Object.keys(updates).length === 0) return

        setIsSaving(true)
        try {
            const updated = await outlineApi.update(outlineId, updates)
            setOutlines((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
            setOpenOutlineDetails((prev) => (prev?.id === updated.id ? updated : prev))
        } catch (e) {
            console.error('Failed to save outline:', e)
        } finally {
            setIsSaving(false)
        }
    }, [])

    const scheduleSave = useCallback((updates: Partial<Pick<Outline, 'content'>>) => {
        if (!openOutlineIdRef.current) return
        pendingUpdatesRef.current = { ...(pendingUpdatesRef.current ?? {}), ...updates }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null
            flushPendingSave()
        }, 900)
    }, [flushPendingSave])

    const actOutlineByNumber = useMemo(() => {
        const map = new Map<number, OutlineSummary>()
        outlines.forEach((outline) => {
            if (outline.type !== 'ACT') return
            if (typeof outline.actNumber !== 'number') return
            map.set(outline.actNumber, outline)
        })
        return map
    }, [outlines])

    const chapterOutlineByChapterId = useMemo(() => {
        const map = new Map<string, OutlineSummary>()
        outlines.forEach((outline) => {
            if (outline.type !== 'CHAPTER') return
            if (!outline.chapterId) return
            map.set(outline.chapterId, outline)
        })
        return map
    }, [outlines])

    const actsToRender = useMemo(() => {
        const effectiveActs: number[] = []

        actNumbers.forEach((actNumber) => {
            const actTitle = getActDisplayTitle(actNumber).toLowerCase()
            const actTitleMatches = normalizedQuery ? actTitle.includes(normalizedQuery) : true

            const actOutline = actOutlineByNumber.get(actNumber) ?? null
            const chaptersWithOutlines = (chaptersByAct[actNumber] || []).filter((chapter) =>
                chapterOutlineByChapterId.has(chapter.id)
            )

            if (!actOutline && chaptersWithOutlines.length === 0) return

            if (!normalizedQuery) {
                effectiveActs.push(actNumber)
                return
            }

            const chapterMatches = chaptersWithOutlines.some((chapter) =>
                chapter.title.toLowerCase().includes(normalizedQuery)
            )

            if (actTitleMatches || chapterMatches) {
                effectiveActs.push(actNumber)
            }
        })

        return effectiveActs
    }, [actNumbers, actOutlineByNumber, chaptersByAct, chapterOutlineByChapterId, getActDisplayTitle, normalizedQuery])

    const openOutlineDialog = useCallback((outlineId: string) => {
        const currentId = openOutlineIdRef.current
        if (currentId && currentId !== outlineId) {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current)
                saveTimerRef.current = null
            }
            flushPendingSave().finally(() => setOpenOutlineId(outlineId))
            return
        }
        setOpenOutlineId(outlineId)
    }, [flushPendingSave])

    const closeOutlineDialog = useCallback(() => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
        }

        flushPendingSave()

        setOpenOutlineId(null)
        setOpenOutlineDetails(null)
        setHistoryOpen(false)
        setCopied(false)
        if (copyTimerRef.current) {
            clearTimeout(copyTimerRef.current)
            copyTimerRef.current = null
        }
    }, [flushPendingSave])

    useEffect(() => {
        if (!openOutlineId) return

        const onPointerDownCapture = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null
            if (!target) return
            if (target.closest('[data-slot="dialog-content"]')) return
            if (target.closest('[data-slot="dialog-overlay"]')) return
            if (target.closest('[data-slot="alert-dialog-content"]')) return
            if (target.closest('[data-slot="alert-dialog-overlay"]')) return
            if (target.closest('[data-outline-floating-panel="true"]')) return
            if (target.closest('[data-outline-entry-trigger="true"]')) return
            void closeOutlineDialog()
        }

        document.addEventListener('pointerdown', onPointerDownCapture, true)
        return () => document.removeEventListener('pointerdown', onPointerDownCapture, true)
    }, [closeOutlineDialog, openOutlineId])

    useEffect(() => {
        if (!requestedOpenOutlineTarget || !novelId) return

        let canceled = false
        const run = async () => {
            const payload: OutlineCreatePayload =
                requestedOpenOutlineTarget.kind === 'act'
                    ? { type: 'ACT', actNumber: requestedOpenOutlineTarget.actNumber }
                    : { type: 'CHAPTER', chapterId: requestedOpenOutlineTarget.chapterId }

            try {
                const created = await outlineApi.create(novelId, payload)
                if (canceled) return
                setOutlines((prev) => {
                    if (prev.some((o) => o.id === created.id)) {
                        return prev.map((o) => (o.id === created.id ? created : o))
                    }
                    return [created, ...prev]
                })
                openOutlineDialog(created.id)
            } catch (e) {
                console.error('Failed to create outline:', e)
            } finally {
                onRequestedOpenOutlineHandled?.()
                void reloadOutlines()
            }
        }

        void run()
        return () => {
            canceled = true
        }
    }, [novelId, onRequestedOpenOutlineHandled, openOutlineDialog, reloadOutlines, requestedOpenOutlineTarget])

    const handleCopy = useCallback(async () => {
        if (!draftPlainText) return
        try {
            await navigator.clipboard.writeText(draftPlainText)
            setCopied(true)
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
            copyTimerRef.current = setTimeout(() => {
                copyTimerRef.current = null
                setCopied(false)
            }, 1400)
        } catch (e) {
            console.error('Failed to copy outline:', e)
        }
    }, [draftPlainText])

    const handleDeleteOutline = useCallback(async (outlineId: string) => {
        try {
            await outlineApi.delete(outlineId)
            setOutlines((prev) => prev.filter((o) => o.id !== outlineId))
            if (openOutlineIdRef.current === outlineId) {
                closeOutlineDialog()
            }
        } catch (e) {
            console.error('Failed to delete outline:', e)
        } finally {
            void reloadOutlines()
        }
    }, [closeOutlineDialog, reloadOutlines])

    const restoreFromHistory = useCallback((value: string) => {
        setDraftContent(value)
        scheduleSave({ content: value })
    }, [scheduleSave])

    const showEmpty = !loading && actsToRender.length === 0

    return (
        <div ref={rootRef} className="flex flex-col h-full">
            <div className="p-2 border-b">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={isCompact ? t('sidebar.searchCompact') : t('outlines.search')}
                            className="pl-8 h-8 text-sm"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                        />
                    </div>
                </div>
                {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
            </div>

            <ScrollArea className="flex-1 min-h-0">
                <div className="p-2 space-y-2">
                    {loading && (
                        <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {tCommon('loading')}
                        </div>
                    )}

                    {actsToRender.map((actNum) => {
                        const actOutline = actOutlineByNumber.get(actNum) ?? null
                        const actTitle = getActDisplayTitle(actNum)

                        const rawChapters = chaptersByAct[actNum] || []
                        const chaptersWithOutlines = rawChapters
                            .filter((chapter) => chapterOutlineByChapterId.has(chapter.id))
                            .filter((chapter) => {
                                if (!normalizedQuery) return true
                                const actTitleMatches = actTitle.toLowerCase().includes(normalizedQuery)
                                if (actTitleMatches) return true
                                return chapter.title.toLowerCase().includes(normalizedQuery)
                            })

                        const isActExpanded = isSearching || expandedActs.has(actNum)
                        const outlineCount = (actOutline ? 1 : 0) + chaptersWithOutlines.length

                        return (
                            <div key={actNum} className="space-y-1">
                                <div className={cn('w-full flex items-center gap-1 px-2 py-1 rounded transition-colors', 'hover:bg-muted')}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!isSearching) onToggleAct(actNum)
                                        }}
                                        className="p-0.5 rounded hover:bg-muted-foreground/10"
                                        aria-label={isActExpanded ? 'Collapse' : 'Expand'}
                                        data-outline-entry-trigger="true"
                                    >
                                        {isActExpanded ? (
                                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                        ) : (
                                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                        )}
                                    </button>

                                    <button
                                        type="button"
                                        className={cn(
                                            'flex-1 text-left text-xs font-semibold text-muted-foreground truncate',
                                            actOutline && 'hover:text-foreground'
                                        )}
                                        onClick={() => {
                                            if (actOutline) {
                                                openOutlineDialog(actOutline.id)
                                                return
                                            }
                                            if (!isSearching) onToggleAct(actNum)
                                        }}
                                        data-outline-entry-trigger="true"
                                        title={actTitle}
                                    >
                                        {actTitle}
                                    </button>

                                    <span className="text-xs text-muted-foreground/70">{outlineCount}</span>
                                </div>

                                {isActExpanded && (
                                    <div className="space-y-1">
                                        {chaptersWithOutlines.map((chapter) => {
                                            const outline = chapterOutlineByChapterId.get(chapter.id) ?? null
                                            if (!outline) return null
                                            return (
                                                <button
                                                    key={chapter.id}
                                                    type="button"
                                                    className="w-full group flex items-center gap-2 px-2 py-1.5 ml-3 rounded text-sm cursor-pointer transition-colors hover:bg-muted"
                                                    onClick={() => openOutlineDialog(outline.id)}
                                                    data-outline-entry-trigger="true"
                                                    title={chapter.title}
                                                >
                                                    <span className="h-6 w-6 flex items-center justify-center text-xs shrink-0 rounded bg-muted text-muted-foreground">
                                                        {getGlobalChapterIndex(chapter.id)}
                                                    </span>

                                                    <span className="truncate flex-1 text-sm">
                                                        {chapter.title}
                                                    </span>

                                                    <span className="text-xs text-muted-foreground shrink-0">
                                                        {outline.wordCount ?? 0}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )
                    })}

                    {showEmpty && (
                        <div className="text-center py-10 text-muted-foreground text-sm">
                            {t('outlines.empty')}
                        </div>
                    )}
                </div>
            </ScrollArea>

            {openOutlineId && anchorRect && typeof window !== 'undefined' && createPortal(
                <div
                    className="fixed z-50"
                    style={{
                        top: Math.max(8, anchorRect.top),
                        left: anchorRect.right,
                        height: Math.max(200, anchorRect.height),
                        width: Math.min(560, Math.max(320, window.innerWidth - anchorRect.right - 12)),
                    }}
                    role="dialog"
                    aria-label={t('outlines.panel.title')}
                    data-outline-floating-panel="true"
                >
                    <div className="h-full w-full rounded-xl border bg-card shadow-2xl overflow-hidden flex flex-col">
                        <div className="p-4 pb-3 flex items-start gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <ClipboardList className="h-4 w-4" />
                                    <span>{t('outlines.panel.title')}</span>
                                    {openOutlineSummary && (
                                        <span className="text-muted-foreground/60">
                                            · {dateFormatter.format(new Date(openOutlineSummary.updatedAt))}
                                        </span>
                                    )}
                                </div>
                                <div className="text-2xl md:text-3xl font-semibold truncate">
                                    {titleForOutline}
                                </div>
                            </div>

                            <div className="shrink-0 flex flex-col items-end gap-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={closeOutlineDialog}
                                    aria-label={t('outlines.panel.close')}
                                    title={t('outlines.panel.close')}
                                >
                                    <X className="h-4 w-4" />
                                </Button>

                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        title={tCommon('delete')}
                                        onClick={() => setDeleteDialogOpen(true)}
                                        disabled={!openOutlineSummary}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 px-4 pb-4">
                            <div className="h-full rounded-lg border bg-background p-3 overflow-auto">
                                {openOutlineDetails && openOutlineDetails.id === openOutlineId ? (
                                    <TipTapEditor
                                        content={draftContent}
                                        onChange={(next) => {
                                            setDraftContent(next)
                                            scheduleSave({ content: next })
                                        }}
                                        placeholder={t('outlines.contentPlaceholder')}
                                        className="min-h-[240px]"
                                        termMentionMatcher={termMentionMatcher}
                                        onTermMentionClick={handleTermMentionClick}
                                    />
                                ) : (
                                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        {tCommon('loading')}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="border-t px-4 py-2 flex items-center justify-between text-sm text-muted-foreground">
                            <div className="flex items-center gap-3">
                                <span>{draftWordCount.toLocaleString()} {tCommon(draftWordCount === 1 ? 'word' : 'words')}</span>
                                <span className="text-muted-foreground/50">·</span>
                                <span>{isSaving || Boolean(saveTimerRef.current) ? tCommon('saving') : tCommon('saved')}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1"
                                    onClick={() => setHistoryOpen(true)}
                                    disabled={detailsLoading}
                                >
                                    <History className="h-4 w-4" />
                                    {t('outlines.panel.history')}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1"
                                    onClick={handleCopy}
                                    disabled={!draftPlainText}
                                >
                                    <Copy className="h-4 w-4" />
                                    {copied ? t('outlines.panel.copied') : t('outlines.panel.copy')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            <TermMentionPreviewPopover
                novelId={novelId}
                open={Boolean(mentionPreview && mentionPreviewEntry)}
                anchorEl={mentionPreview?.anchorEl ?? null}
                entry={mentionPreviewEntry}
                onClose={() => setMentionPreview(null)}
            />

            <RevisionHistoryDialog
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                currentValue={draftContent}
                historyItems={historyItems}
                onRestore={restoreFromHistory}
                title={t('outlines.history.title')}
                restoreLabel={t('outlines.history.restore')}
                closeLabel={t('outlines.history.close')}
                emptyLabel={t('outlines.history.empty')}
                editedByLabel={t('outlines.history.editedByYou')}
                previewTransform={htmlToText}
            />

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('outlines.deleteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('outlines.deleteDialog.description')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                const outlineId = openOutlineIdRef.current
                                if (outlineId) void handleDeleteOutline(outlineId)
                                setDeleteDialogOpen(false)
                            }}
                        >
                            {tCommon('delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
