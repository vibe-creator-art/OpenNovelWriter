'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocale, useTranslations } from 'next-intl'
import { snippetApi, type Snippet } from '@/lib/api'
import { cn } from '@/lib/utils'
import { htmlToText } from '@/lib/html-to-text'
import { htmlToMarkdown } from '@/lib/html-to-markdown'
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
import { MarkdownToolbarEditor } from '@/components/editor/markdown-toolbar-editor'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import { buildTermMentionMatcher } from '@/components/editor/terms/term-mentions-utils'
import { TermMentionPreviewPopover } from '@/components/editor/terms/term-mention-preview-popover'
import type { AnchorRect } from '@/components/editor/terms/types'
import { countWords, getAnchorRect } from '@/components/editor/terms/utils'
import { SnippetHistoryDialog } from '@/components/editor/snippets/snippet-history-dialog'
import {
    NOVEL_REFRESH_REQUESTED_EVENT,
    type NovelRefreshRequestedEventDetail,
} from '@/lib/novel-refresh-events'
import { ChevronDown, ChevronRight, Copy, History, Loader2, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react'
import { TermEntryMarkdown } from '@/components/editor/terms/term-entry-markdown'

interface LeftPanelSnippetsProps {
    novelId?: string
    isCompact: boolean
    requestedOpenSnippetId?: string | null
    onRequestedOpenSnippetHandled?: () => void
}

function getSnippetDisplayTitle(snippet: Snippet, fallback: string) {
    const title = snippet.title?.trim()
    if (title) return title
    const content = htmlToText(snippet.content).trim()
    if (content) return content.split('\n')[0]?.trim() || fallback
    return fallback
}

export function LeftPanelSnippets({
    novelId,
    isCompact,
    requestedOpenSnippetId,
    onRequestedOpenSnippetHandled,
}: LeftPanelSnippetsProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const locale = useLocale()

    const rootRef = useRef<HTMLDivElement | null>(null)
    const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null)

    const [snippets, setSnippets] = useState<Snippet[]>([])
    const [loading, setLoading] = useState(false)
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [searchQuery, setSearchQuery] = useState('')
    const normalizedQuery = searchQuery.trim().toLowerCase()

    const [openSnippetId, setOpenSnippetId] = useState<string | null>(null)
    const openSnippetIdRef = useRef<string | null>(null)
    openSnippetIdRef.current = openSnippetId

    const openSnippetFromList = useMemo(
        () => snippets.find((snippet) => snippet.id === openSnippetId) ?? null,
        [openSnippetId, snippets]
    )

    const [openSnippetDetails, setOpenSnippetDetails] = useState<Snippet | null>(null)
    const [detailsLoading, setDetailsLoading] = useState(false)

    const openSnippet = useMemo(() => {
        if (openSnippetDetails && openSnippetDetails.id === openSnippetId) return openSnippetDetails
        return openSnippetFromList
    }, [openSnippetDetails, openSnippetFromList, openSnippetId])

    const [draftTitle, setDraftTitle] = useState('')
    const [draftContent, setDraftContent] = useState('')
    const [previewOpen, setPreviewOpen] = useState(false)
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
    const pendingUpdatesRef = useRef<Partial<Pick<Snippet, 'title' | 'content'>> | null>(null)

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

    const reloadSnippets = useCallback(async () => {
        if (!novelId) return
        setLoading(true)
        setError(null)
        try {
            const items = await snippetApi.list(novelId)
            setSnippets(items)
        } catch (e) {
            console.error('Failed to load snippets:', e)
            setError(t('snippets.loadError'))
        } finally {
            setLoading(false)
        }
    }, [novelId, t])

    useEffect(() => {
        if (!novelId) return
        reloadSnippets()
    }, [novelId, reloadSnippets])

    useEffect(() => {
        if (!novelId) return
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<NovelRefreshRequestedEventDetail>).detail
            if (!detail || detail.novelId !== novelId) return
            void reloadSnippets()
        }

        window.addEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handler as EventListener)
        return () => window.removeEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handler as EventListener)
    }, [novelId, reloadSnippets])

    useEffect(() => {
        if (!openSnippet) return
        setDraftTitle(openSnippet.title ?? '')
        setDraftContent(openSnippet.content ?? '')
        setPreviewOpen(false)
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
    }, [openSnippet?.id]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!openSnippetId) {
            setOpenSnippetDetails(null)
            setDetailsLoading(false)
            return
        }

        let canceled = false
        setDetailsLoading(true)
        snippetApi.get(openSnippetId)
            .then((detail) => {
                if (canceled) return
                setOpenSnippetDetails(detail)
            })
            .catch((e) => {
                console.error('Failed to load snippet details:', e)
                if (canceled) return
                setOpenSnippetDetails(null)
            })
            .finally(() => {
                if (canceled) return
                setDetailsLoading(false)
            })

        return () => {
            canceled = true
        }
    }, [openSnippetId])

    const flushPendingSave = useCallback(async () => {
        const snippetId = openSnippetIdRef.current
        const updates = pendingUpdatesRef.current
        pendingUpdatesRef.current = null
        if (!snippetId || !updates || Object.keys(updates).length === 0) return

        setIsSaving(true)
        try {
            const updated = await snippetApi.update(snippetId, updates)
            setSnippets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
            setOpenSnippetDetails((prev) => (prev?.id === updated.id ? updated : prev))
        } catch (e) {
            console.error('Failed to save snippet:', e)
        } finally {
            setIsSaving(false)
        }
    }, [])

    const scheduleSave = useCallback((updates: Partial<Pick<Snippet, 'title' | 'content'>>) => {
        if (!openSnippetIdRef.current) return
        pendingUpdatesRef.current = { ...(pendingUpdatesRef.current ?? {}), ...updates }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null
            flushPendingSave()
        }, 900)
    }, [flushPendingSave])

    const filteredSnippets = useMemo(() => {
        const list = [...snippets].sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
            const aTime = new Date(a.updatedAt).getTime()
            const bTime = new Date(b.updatedAt).getTime()
            return bTime - aTime
        })

        if (!normalizedQuery) return list
        return list.filter((snippet) => {
            const title = (snippet.title ?? '').toLowerCase()
            if (title.includes(normalizedQuery)) return true
            const content = htmlToText(snippet.content).toLowerCase()
            return content.includes(normalizedQuery)
        })
    }, [normalizedQuery, snippets])

    const pinnedSnippets = useMemo(() => filteredSnippets.filter((s) => s.pinned), [filteredSnippets])
    const unpinnedSnippets = useMemo(() => filteredSnippets.filter((s) => !s.pinned), [filteredSnippets])

    const openSnippetDialog = useCallback((snippetId: string) => {
        const currentId = openSnippetIdRef.current
        if (currentId && currentId !== snippetId) {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current)
                saveTimerRef.current = null
            }
            flushPendingSave().finally(() => setOpenSnippetId(snippetId))
            return
        }
        setOpenSnippetId(snippetId)
    }, [flushPendingSave])

    useEffect(() => {
        if (!requestedOpenSnippetId) return
        openSnippetDialog(requestedOpenSnippetId)
        onRequestedOpenSnippetHandled?.()
    }, [onRequestedOpenSnippetHandled, openSnippetDialog, requestedOpenSnippetId])

    const closeSnippetDialog = useCallback(() => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
        }

        // Close immediately, flush pending changes in the background.
        flushPendingSave()

        setOpenSnippetId(null)
        setOpenSnippetDetails(null)
        setPreviewOpen(false)
        setHistoryOpen(false)
        setCopied(false)
        if (copyTimerRef.current) {
            clearTimeout(copyTimerRef.current)
            copyTimerRef.current = null
        }
    }, [flushPendingSave])

    useEffect(() => {
        if (!openSnippetId) return

        const onPointerDownCapture = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null
            if (!target) return
            if (target.closest('[data-slot="dialog-content"]')) return
            if (target.closest('[data-slot="dialog-overlay"]')) return
            if (target.closest('[data-slot="alert-dialog-content"]')) return
            if (target.closest('[data-slot="alert-dialog-overlay"]')) return
            if (target.closest('[data-snippet-floating-panel="true"]')) return
            if (target.closest('[data-snippet-entry-trigger="true"]')) return
            void closeSnippetDialog()
        }

        document.addEventListener('pointerdown', onPointerDownCapture, true)
        return () => document.removeEventListener('pointerdown', onPointerDownCapture, true)
    }, [closeSnippetDialog, openSnippetId])

    const handleCreateSnippet = useCallback(async () => {
        if (!novelId || creating) return
        setCreating(true)
        try {
            const created = await snippetApi.create(novelId, { title: '', content: '', pinned: false })
            setSnippets((prev) => [created, ...prev])
            openSnippetDialog(created.id)
        } catch (e) {
            console.error('Failed to create snippet:', e)
            setError(t('snippets.createError'))
        } finally {
            setCreating(false)
        }
    }, [creating, novelId, openSnippetDialog, t])

    const handleTogglePin = useCallback(async (snippet: Snippet) => {
        try {
            const updated = await snippetApi.update(snippet.id, { pinned: !snippet.pinned })
            setSnippets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
            setOpenSnippetDetails((prev) => (prev?.id === updated.id ? updated : prev))
        } catch (e) {
            console.error('Failed to toggle pin:', e)
        }
    }, [])

    const handleDeleteSnippet = useCallback(async (snippetId: string) => {
        try {
            await snippetApi.delete(snippetId)
            setSnippets((prev) => prev.filter((s) => s.id !== snippetId))
            if (openSnippetIdRef.current === snippetId) {
                setOpenSnippetId(null)
                setOpenSnippetDetails(null)
                setPreviewOpen(false)
                setHistoryOpen(false)
                setCopied(false)
            }
        } catch (e) {
            console.error('Failed to delete snippet:', e)
        }
    }, [])

    const renderSnippetItem = (snippet: Snippet) => {
        const isActive = openSnippetId === snippet.id
        const title = getSnippetDisplayTitle(snippet, t('snippets.untitled'))
        const preview = htmlToText(snippet.content).trim().replace(/\s+/g, ' ')
        const previewText = preview ? preview.slice(0, 80) : t('snippets.emptyPreview')
        const dateText = snippet.updatedAt ? dateFormatter.format(new Date(snippet.updatedAt)) : ''

        return (
            <div
                key={snippet.id}
                role="button"
                tabIndex={0}
                data-snippet-entry-trigger="true"
                data-snippet-entry-id={snippet.id}
                className={cn(
                    'group box-border h-[86px] w-full max-w-full min-w-0 overflow-hidden rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/40',
                    isActive && 'bg-muted ring-1 ring-primary/40'
                )}
                onClick={() => openSnippetDialog(snippet.id)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openSnippetDialog(snippet.id)
                    }
                }}
            >
                <div className="grid h-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_auto] gap-x-2 overflow-hidden">
                    <div className="min-w-0 overflow-hidden">
                        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                            <span className="block min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
                            {snippet.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title={snippet.pinned ? t('snippets.unpin') : t('snippets.pin')}
                        onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            handleTogglePin(snippet)
                        }}
                    >
                        {snippet.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </Button>
                    <div className="col-span-2 block min-w-0 truncate text-xs text-muted-foreground">{previewText}</div>
                    <div className="col-span-2 mt-1 block min-w-0 truncate text-xs text-muted-foreground/70">{dateText}</div>
                </div>
            </div>
        )
    }

    const showEmpty = !loading && filteredSnippets.length === 0
    const draftPlainText = useMemo(
        () => htmlToText(draftContent, { paragraphSeparator: '\n' }).trim(),
        [draftContent]
    )
    const draftPreviewMarkdown = useMemo(() => htmlToMarkdown(draftContent), [draftContent])
    const draftWordCount = useMemo(() => countWords(draftPlainText), [draftPlainText])
    const historyItems = openSnippet?.history ?? []

    useEffect(() => {
        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current)
                saveTimerRef.current = null
            }

            const snippetId = openSnippetIdRef.current
            const updates = pendingUpdatesRef.current
            pendingUpdatesRef.current = null
            if (snippetId && updates && Object.keys(updates).length > 0) {
                snippetApi.update(snippetId, updates).catch((error) => {
                    console.error('Failed to flush snippet before unmount:', error)
                })
            }

            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current)
                copyTimerRef.current = null
            }
        }
    }, [])

    const handleCopy = useCallback(async () => {
        if (!draftPlainText) return
        try {
            await navigator.clipboard.writeText(draftPlainText)
            setCopied(true)
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
            copyTimerRef.current = setTimeout(() => {
                setCopied(false)
            }, 1200)
        } catch (e) {
            console.error('Failed to copy snippet:', e)
        }
    }, [draftPlainText])

    const handleRestoreHistory = useCallback((content: string) => {
        setDraftContent(content)
        scheduleSave({ content })
    }, [scheduleSave])

    return (
        <div ref={rootRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="p-2 border-b">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={t('snippets.search')}
                            className="pl-8 h-8 text-sm"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                        />
                    </div>
                    <Button
                        variant="ghost"
                        size={isCompact ? 'icon' : 'sm'}
                        className={cn(isCompact ? 'h-8 w-8' : 'h-8')}
                        onClick={handleCreateSnippet}
                        disabled={!novelId || creating}
                        title={t('snippets.new')}
                    >
                        {creating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <Plus className="h-4 w-4" />
                                {!isCompact && <span className="ml-1 text-xs">{t('snippets.new')}</span>}
                            </>
                        )}
                    </Button>
                </div>
                {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
            </div>

            <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="min-w-0 space-y-3 p-2">
                    {loading && (
                        <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {tCommon('loading')}
                        </div>
                    )}

                    {pinnedSnippets.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground flex items-center justify-between px-1">
                                <span>{t('snippets.pinned')}</span>
                                <span>{pinnedSnippets.length}</span>
                            </div>
                            <div className="space-y-2">
                                {pinnedSnippets.map(renderSnippetItem)}
                            </div>
                        </div>
                    )}

                    {unpinnedSnippets.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground flex items-center justify-between px-1">
                                <span>{pinnedSnippets.length > 0 ? t('snippets.unpinned') : t('snippets.all')}</span>
                                <span>{unpinnedSnippets.length}</span>
                            </div>
                            <div className="space-y-2">
                                {unpinnedSnippets.map(renderSnippetItem)}
                            </div>
                        </div>
                    )}

                    {showEmpty && (
                        <div className="text-center py-10 text-muted-foreground text-sm">
                            {t('snippets.empty')}
                        </div>
                    )}
                </div>
            </ScrollArea>

            {openSnippetId && anchorRect && typeof window !== 'undefined' && createPortal(
                <div
                    className="fixed z-50"
                    style={{
                        top: Math.max(8, anchorRect.top),
                        left: anchorRect.right,
                        height: Math.max(200, anchorRect.height),
                        width: Math.min(560, Math.max(320, window.innerWidth - anchorRect.right - 12)),
                    }}
                    role="dialog"
                    aria-label={t('snippets.panel.title')}
                    data-snippet-floating-panel="true"
                >
                    <div className="h-full w-full rounded-xl border bg-card shadow-2xl overflow-hidden flex flex-col">
                        <div className="p-4 pb-3 flex items-start gap-3">
                            <div className="min-w-0 flex-1 space-y-2">
                                <Input
                                    value={draftTitle}
                                    placeholder={t('snippets.titlePlaceholder')}
                                    onChange={(event) => {
                                        const next = event.target.value
                                        setDraftTitle(next)
                                        scheduleSave({ title: next })
                                    }}
                                    className={cn(
                                        'h-auto px-3 py-2 text-3xl md:text-3xl font-semibold leading-none',
                                        'border-transparent shadow-none bg-transparent hover:border-border hover:bg-muted/20',
                                        'focus-visible:bg-background'
                                    )}
                                />
                            </div>

                            <div className="shrink-0 flex flex-col items-end gap-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={closeSnippetDialog}
                                    aria-label={t('snippets.panel.close')}
                                    title={t('snippets.panel.close')}
                                >
                                    <X className="h-4 w-4" />
                                </Button>

                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        title={openSnippet?.pinned ? t('snippets.unpin') : t('snippets.pin')}
                                        onClick={() => openSnippet && handleTogglePin(openSnippet)}
                                        disabled={!openSnippet}
                                    >
                                        {openSnippet?.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        title={tCommon('delete')}
                                        onClick={() => setDeleteDialogOpen(true)}
                                        disabled={!openSnippet}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col gap-3">
                            <div className="min-h-0 flex-1 overflow-hidden">
                                {openSnippet ? (
                                    <MarkdownToolbarEditor
                                        value={draftContent}
                                        valueFormat="html"
                                        onChange={(next) => {
                                            setDraftContent(next)
                                            scheduleSave({ content: next })
                                        }}
                                        placeholder={t('snippets.contentPlaceholder')}
                                        className="h-full min-h-0 overflow-hidden"
                                        contentClassName="min-h-0 flex-1 overflow-auto"
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

                            {openSnippet && (
                                <div className="shrink-0 space-y-2">
                                    <button
                                        type="button"
                                        className="flex w-full items-center justify-between rounded-md border bg-muted/10 px-3 py-2 text-left transition-colors hover:bg-muted/20"
                                        onClick={() => setPreviewOpen((current) => !current)}
                                        aria-expanded={previewOpen}
                                        aria-label={
                                            previewOpen
                                                ? t('snippets.panel.previewCollapse')
                                                : t('snippets.panel.previewExpand')
                                        }
                                    >
                                        <span className="text-sm font-medium">{t('snippets.panel.preview')}</span>
                                        <span className="text-muted-foreground">
                                            {previewOpen ? (
                                                <ChevronDown className="h-4 w-4" />
                                            ) : (
                                                <ChevronRight className="h-4 w-4" />
                                            )}
                                        </span>
                                    </button>

                                    {previewOpen && (
                                        <div className="max-h-72 min-h-24 overflow-auto rounded-md border bg-muted/20 px-3 py-2">
                                            <TermEntryMarkdown content={draftPreviewMarkdown} />
                                        </div>
                                    )}
                                </div>
                            )}
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
                                    {t('snippets.panel.history')}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1"
                                    onClick={handleCopy}
                                    disabled={!draftPlainText}
                                >
                                    <Copy className="h-4 w-4" />
                                    {copied ? t('snippets.panel.copied') : t('snippets.panel.copy')}
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

            <SnippetHistoryDialog
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                currentValue={draftContent}
                historyItems={historyItems}
                onRestore={handleRestoreHistory}
            />

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('snippets.deleteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('snippets.deleteDialog.description')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                const snippetId = openSnippetIdRef.current
                                if (snippetId) handleDeleteSnippet(snippetId)
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
