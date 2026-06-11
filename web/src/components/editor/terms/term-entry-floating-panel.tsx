import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Archive, Check, ChevronDown, ChevronRight, Copy, History, MoreVertical, Trash2, X } from 'lucide-react'
import type { AnchorRect, TermCategoryView, TermEntry } from '@/components/editor/terms/types'
import type { TermEntryPanelTab } from '@/components/editor/terms/term-entry-events'
import { TERM_ENTRY_COLOR_IDS, getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import { countWords, renderIconSpec } from '@/components/editor/terms/utils'
import { ImageField } from '@/components/image/image-field'
import { CroppedImage } from '@/components/image/cropped-image'
import { parseImageCrop, serializeImageCrop } from '@/lib/image-crop'
import { recordRevisionHistory } from '@/lib/revision-history'
import { TermEntryHistoryDialog } from '@/components/editor/terms/term-entry-history-dialog'
import { TermEntryMentionsSparkline } from '@/components/editor/terms/term-entry-mentions-sparkline'
import { TermEntryMentionsTab } from '@/components/editor/terms/term-entry-mentions-tab'
import { TermEntryRelationsTab } from '@/components/editor/terms/term-entry-relations-tab'
import { TermEntryResearchTab } from '@/components/editor/terms/term-entry-research-tab'
import { TermEntryTrackingTab } from '@/components/editor/terms/term-entry-tracking-tab'
import { TermEntryGalleryTab } from '@/components/editor/terms/term-entry-gallery-tab'
import { TermEntryExperiencesTab } from '@/components/editor/terms/term-entry-experiences-tab'
import { TermEntryTags } from '@/components/editor/terms/term-entry-tags'
import { outlineApi, snippetApi, type ChapterWithScenes, type Outline, type Snippet } from '@/lib/api'
import { normalizeTermTitleKey } from '@/lib/term-state'
import {
    scanEntryManuscriptMentions,
    scanEntryManuscriptMentionSparkline,
    scanEntrySummaryMentionScenes,
} from '@/components/editor/terms/manuscript-mentions'
import { scanTermDescriptionMentions } from '@/components/editor/terms/term-description-mentions'
import { scanSnippetMentions } from '@/components/editor/terms/snippet-mentions'
import { scanOutlineMentions } from '@/components/editor/terms/outline-mentions'
import { buildTermMentionMatcher } from '@/components/editor/terms/term-mentions-utils'
import { TermMentionPreviewPopover } from '@/components/editor/terms/term-mention-preview-popover'
import { MarkdownToolbarEditor } from '@/components/editor/markdown-toolbar-editor'
import { TermEntryMarkdown } from '@/components/editor/terms/term-entry-markdown'

type TermEntryFloatingPanelProps = {
    novelId?: string
    anchorRect: AnchorRect
    entry: TermEntry
    entries: TermEntry[]
    manuscriptChapters?: ChapterWithScenes[]
    category: TermCategoryView
    categories: TermCategoryView[]
    allTags: string[]
    initialTab?: TermEntryPanelTab
    onClose: () => void
    onNavigateToEntry: (entryId: string, tab: TermEntryPanelTab) => void
    onNavigateToManuscript?: (chapterId: string, sceneId?: string, termId?: string, target?: 'manuscript' | 'summary') => void
    onNavigateToSnippet?: (snippetId: string) => void
    onNavigateToOutline?: (target: { kind: 'act'; actNumber: number } | { kind: 'chapter'; chapterId: string }) => void
    onArchive: () => void
    onDelete: () => void
    onAddRelation: (otherEntryId: string) => void
    onUpdateRelation: (relationId: string, patch: { direction?: 'outgoing' | 'incoming' | 'bidirectional'; label?: string }) => void
    onDeleteRelation: (relationId: string) => void
    onUpdate: (patch: Partial<TermEntry>) => void
}

type TitleDraftState = {
    entryId: string
    savedTitle: string
    draft: string
    error: string | null
}

export function TermEntryFloatingPanel({
    novelId,
    anchorRect,
    entry,
    entries,
    manuscriptChapters,
    category,
    categories,
    allTags,
    initialTab,
    onClose,
    onNavigateToEntry,
    onNavigateToManuscript,
    onNavigateToSnippet,
    onNavigateToOutline,
    onArchive,
    onDelete,
    onAddRelation,
    onUpdateRelation,
    onDeleteRelation,
    onUpdate,
}: TermEntryFloatingPanelProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const [activeTab, setActiveTab] = useState<TermEntryPanelTab>(initialTab ?? 'details')
    const [researchTab, setResearchTab] = useState<'notes' | 'external'>('notes')
    const [historyOpen, setHistoryOpen] = useState(false)
    const [historyField, setHistoryField] = useState<'description' | 'researchNotes'>('description')
    const [copied, setCopied] = useState(false)
    const [descriptionPreviewEntryId, setDescriptionPreviewEntryId] = useState<string | null>(null)
    const [titleState, setTitleState] = useState<TitleDraftState>(() => ({
        entryId: entry.id,
        savedTitle: entry.title,
        draft: entry.title,
        error: null,
    }))
    const descriptionPreviewOpen = descriptionPreviewEntryId === entry.id
    const visibleTitleState =
        titleState.entryId === entry.id && titleState.savedTitle === entry.title
            ? titleState
            : { entryId: entry.id, savedTitle: entry.title, draft: entry.title, error: null }
    const titleDraft = visibleTitleState.draft
    const titleError = visibleTitleState.error

    const maxWidth = Math.max(320, window.innerWidth - anchorRect.right - 12)
    const panelWidth = Math.min(560, maxWidth)

    const footerField =
        activeTab === 'details' ? 'description' : activeTab === 'research' && researchTab === 'notes' ? 'researchNotes' : null
    const footerValue =
        footerField === 'description'
            ? entry.description ?? ''
            : footerField === 'researchNotes'
                ? entry.researchNotes ?? ''
                : ''
    const wordCount = useMemo(() => countWords(footerValue), [footerValue])

    const historyItems = useMemo(
        () => (historyField === 'researchNotes' ? entry.researchNotesHistory ?? [] : entry.history ?? []),
        [entry.history, entry.researchNotesHistory, historyField]
    )
    const currentHistoryValue = historyField === 'researchNotes' ? entry.researchNotes ?? '' : entry.description ?? ''

    const colorId = getTermEntryColorId(entry.color)
    const colorClasses = getTermEntryColorClasses(colorId)
    const titleAccent = colorId !== 'black'
    const iconAccent = !entry.avatar && titleAccent
    const hasProtectedContent = Boolean((entry.description ?? '').trim() || (entry.researchNotes ?? '').trim())
    const termMentionMatcher = useMemo(() => buildTermMentionMatcher(entries), [entries])
    const termEntriesById = useMemo(() => new Map(entries.map((item) => [item.id, item] as const)), [entries])
    const [mentionPreview, setMentionPreview] = useState<{ termId: string; anchorEl: HTMLElement } | null>(null)

    const handleTermMentionClick = useCallback((termId: string, anchorEl: HTMLElement) => {
        setMentionPreview((prev) => {
            if (prev?.termId === termId && prev.anchorEl === anchorEl) return null
            return { termId, anchorEl }
        })
    }, [setMentionPreview])

    const mentionPreviewEntry = useMemo(() => {
        if (!mentionPreview) return null
        return termEntriesById.get(mentionPreview.termId) ?? null
    }, [mentionPreview, termEntriesById])

    const hasDuplicateTitle = useCallback(
        (value: string) => {
            const key = normalizeTermTitleKey(value)
            if (!key) return false
            return entries.some((candidate) => candidate.id !== entry.id && !candidate.archived && normalizeTermTitleKey(candidate.title) === key)
        },
        [entry.id, entries]
    )

    const commitTitleDraft = useCallback(() => {
        const nextTitle = titleDraft.trim()
        if (!nextTitle) {
            setTitleState({ entryId: entry.id, savedTitle: entry.title, draft: entry.title, error: null })
            return
        }

        if (nextTitle === entry.title.trim()) {
            setTitleState({ entryId: entry.id, savedTitle: entry.title, draft: nextTitle, error: null })
            return
        }

        if (hasDuplicateTitle(nextTitle)) {
            setTitleState({
                entryId: entry.id,
                savedTitle: entry.title,
                draft: entry.title,
                error: t('terms.createErrors.duplicateTitle'),
            })
            return
        }

        setTitleState({ entryId: entry.id, savedTitle: entry.title, draft: nextTitle, error: null })
        onUpdate({ title: nextTitle })
    }, [entry.id, entry.title, hasDuplicateTitle, onUpdate, t, titleDraft])

    const chapterIndexById = useMemo(() => {
        const map = new Map<string, number>()
        if (!manuscriptChapters?.length) return map
        const sorted = manuscriptChapters.slice().sort((a, b) => a.actNumber - b.actNumber || a.order - b.order)
        sorted.forEach((chapter, idx) => map.set(chapter.id, idx + 1))
        return map
    }, [manuscriptChapters])

    const chapterTitleById = useMemo(() => {
        return new Map((manuscriptChapters ?? []).map((chapter) => [chapter.id, chapter.title] as const))
    }, [manuscriptChapters])

    const manuscriptMentionSparkline = useMemo(() => {
        if (!manuscriptChapters?.length) return { totalCount: 0, sceneMentions: [] as number[] }
        return scanEntryManuscriptMentionSparkline(entry.title, entry.aliases, manuscriptChapters)
    }, [entry.title, entry.aliases, manuscriptChapters])

    const manuscriptMentionDetails = useMemo(() => {
        if (activeTab !== 'mentions') return { totalCount: manuscriptMentionSparkline.totalCount, groups: [] }
        if (!manuscriptChapters?.length) return { totalCount: manuscriptMentionSparkline.totalCount, groups: [] }
        return scanEntryManuscriptMentions(entry.title, entry.aliases, manuscriptChapters, { includeSnippets: true })
    }, [activeTab, entry.title, entry.aliases, manuscriptChapters, manuscriptMentionSparkline.totalCount])

    const summaryMentionData = useMemo(() => {
        if (activeTab !== 'mentions') return { totalCount: 0, scenes: [] }
        if (!manuscriptChapters?.length) return { totalCount: 0, scenes: [] }
        return scanEntrySummaryMentionScenes(entry.title, entry.aliases, manuscriptChapters)
    }, [activeTab, entry.title, entry.aliases, manuscriptChapters])

    const termDescriptionMentionData = useMemo(() => {
        if (activeTab !== 'mentions') return { count: 0, mentions: [] }
        return scanTermDescriptionMentions({ entryId: entry.id, title: entry.title, aliases: entry.aliases }, entries)
    }, [activeTab, entry.id, entry.title, entry.aliases, entries])

    const [snippets, setSnippets] = useState<Snippet[] | null>(null)
    const [snippetsError, setSnippetsError] = useState(false)

    const snippetsStatus = useMemo(() => {
        if (snippetsError) return 'error' as const
        if (snippets === null) return activeTab === 'mentions' ? ('loading' as const) : ('idle' as const)
        return 'loaded' as const
    }, [activeTab, snippets, snippetsError])

    useEffect(() => {
        if (activeTab !== 'mentions') return
        if (!novelId) return
        if (snippets !== null) return
        if (snippetsError) return

        let canceled = false

        snippetApi
            .list(novelId)
            .then((items) => {
                if (canceled) return
                setSnippets(items)
            })
            .catch((error) => {
                console.error('Failed to load snippets for mentions:', error)
                if (canceled) return
                setSnippetsError(true)
            })

        return () => {
            canceled = true
        }
    }, [activeTab, novelId, snippets, snippetsError])

    const snippetMentionData = useMemo(() => {
        if (activeTab !== 'mentions') return { count: 0, mentions: [] }
        if (snippetsStatus !== 'loaded' || !snippets) return { count: 0, mentions: [] }
        return scanSnippetMentions({ title: entry.title, aliases: entry.aliases }, snippets)
    }, [activeTab, entry.title, entry.aliases, snippets, snippetsStatus])

    const [outlines, setOutlines] = useState<Outline[] | null>(null)
    const [outlinesError, setOutlinesError] = useState(false)

    const outlinesStatus = useMemo(() => {
        if (outlinesError) return 'error' as const
        if (outlines === null) return activeTab === 'mentions' ? ('loading' as const) : ('idle' as const)
        return 'loaded' as const
    }, [activeTab, outlines, outlinesError])

    useEffect(() => {
        if (activeTab !== 'mentions') return
        if (!novelId) return
        if (outlines !== null) return
        if (outlinesError) return

        let canceled = false

        const load = async () => {
            try {
                const summaries = await outlineApi.list(novelId)
                if (canceled) return
                if (summaries.length === 0) {
                    setOutlines([])
                    return
                }

                const details: Outline[] = []
                const batchSize = 6
                for (let i = 0; i < summaries.length; i += batchSize) {
                    const batch = summaries.slice(i, i + batchSize)
                    const results = await Promise.all(
                        batch.map((summary) => outlineApi.get(summary.id).catch(() => null))
                    )
                    if (canceled) return
                    details.push(...(results.filter(Boolean) as Outline[]))
                }

                setOutlines(details)
            } catch (error) {
                console.error('Failed to load outlines for mentions:', error)
                if (canceled) return
                setOutlinesError(true)
            }
        }

        void load()

        return () => {
            canceled = true
        }
    }, [activeTab, novelId, outlines, outlinesError])

    const outlineMentionData = useMemo(() => {
        if (activeTab !== 'mentions') return { count: 0, mentions: [] }
        if (outlinesStatus !== 'loaded' || !outlines) return { count: 0, mentions: [] }

        const scanned = scanOutlineMentions({ title: entry.title, aliases: entry.aliases }, outlines)
        if (scanned.mentions.length === 0) return scanned

        return {
            count: scanned.count,
            mentions: scanned.mentions.map((mention) => {
                if (mention.outlineType !== 'CHAPTER' || !mention.chapterId) return mention
                return {
                    ...mention,
                    chapterIndex: chapterIndexById.get(mention.chapterId),
                    chapterTitle: chapterTitleById.get(mention.chapterId),
                }
            }),
        }
    }, [activeTab, chapterIndexById, chapterTitleById, entry.aliases, entry.title, outlines, outlinesStatus])

    return createPortal(
        <div
            className="fixed z-50"
            style={{
                top: Math.max(8, anchorRect.top),
                left: anchorRect.right,
                height: Math.max(200, anchorRect.height),
                width: panelWidth,
            }}
            role="dialog"
            aria-label={t('terms.panel.title')}
            data-term-floating-panel="true"
        >
            <div className="h-full w-full rounded-xl border bg-card shadow-2xl overflow-hidden flex flex-col">
                <div className="p-4 pb-3">
                    <div className="flex items-start gap-4">
                        <div className="min-w-0 flex-1 space-y-2">
                            <DropdownMenu modal={false}>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={cn(
                                            'inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors',
                                            'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40 hover:border-foreground/20',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                                        )}
                                    >
                                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full border bg-background text-muted-foreground">
                                            {renderIconSpec(category.icon, 'h-4 w-4 rounded-full text-muted-foreground')}
                                        </span>
                                        <span className="font-medium">{category.label}</span>
                                        <ChevronDown className="h-4 w-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" data-term-floating-panel="true">
                                    {categories.map((c) => (
                                        <DropdownMenuItem key={c.id} onSelect={() => onUpdate({ categoryId: c.id })}>
                                            {renderIconSpec(c.icon, 'h-4 w-4 rounded-full text-muted-foreground')}
                                            <span>{c.label}</span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <Input
                                value={titleDraft}
                                onChange={(e) => {
                                    setTitleState({
                                        entryId: entry.id,
                                        savedTitle: entry.title,
                                        draft: e.target.value,
                                        error: null,
                                    })
                                }}
                                onBlur={commitTitleDraft}
                                className={cn(
                                    'h-auto px-3 py-2 text-3xl md:text-3xl font-semibold leading-none',
                                    'border-transparent shadow-none bg-transparent hover:border-border hover:bg-muted/20',
                                    'focus-visible:bg-background',
                                    titleAccent && colorClasses.text
                                )}
                            />
                            {titleError && <div className="text-xs text-destructive">{titleError}</div>}

                            <TermEntryTags tags={entry.tags} allTags={allTags} onChange={(nextTags) => onUpdate({ tags: nextTags })} />
                        </div>

                        <div className="shrink-0 flex flex-col items-end gap-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={onClose}
                                aria-label={t('terms.panel.close')}
                                title={t('terms.panel.close')}
                            >
                                <X className="h-4 w-4" />
                            </Button>

                            <ImageField
                                aspect={1}
                                shape="circle"
                                value={entry.avatar ? { url: entry.avatar, crop: parseImageCrop(entry.avatarCrop) } : null}
                                onChange={(next) =>
                                    onUpdate({
                                        avatar: next?.url ?? undefined,
                                        avatarCrop: serializeImageCrop(next?.crop ?? null) ?? undefined,
                                    })
                                }
                                renderTrigger={({ open }) => (
                                    <button
                                        type="button"
                                        className={cn(
                                            'group relative h-20 w-20 rounded-xl border overflow-hidden flex items-center justify-center',
                                            entry.avatar ? 'bg-muted text-muted-foreground' : iconAccent ? `${colorClasses.subtleBg} ${colorClasses.subtleBorder}` : 'bg-muted'
                                        )}
                                        onClick={open}
                                        title={t('terms.panel.avatar.upload')}
                                        aria-label={t('terms.panel.avatar.upload')}
                                    >
                                        {entry.avatar ? (
                                            <CroppedImage
                                                src={entry.avatar}
                                                crop={parseImageCrop(entry.avatarCrop)}
                                                aspectRatio={1}
                                                className="h-full w-full"
                                            />
                                        ) : (
                                            <span className="[&_svg]:h-10 [&_svg]:w-10">
                                                {renderIconSpec(category.icon, cn('h-10 w-10', iconAccent ? colorClasses.icon : 'text-muted-foreground'))}
                                            </span>
                                        )}
                                        <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs flex items-center justify-center">
                                            {t('terms.panel.avatar.upload')}
                                        </span>
                                    </button>
                                )}
                            />
                        </div>
                    </div>

                    <div className="mt-3">
                        <TermEntryMentionsSparkline
                            count={manuscriptMentionDetails.totalCount}
                            sceneMentions={manuscriptMentionSparkline.sceneMentions}
                        />
                    </div>

                    <Separator className="mt-3" />

                    <div className="mt-2 flex items-center gap-2">
                        <div className="flex items-center gap-2">
                            {(
                                [
                                    { id: 'details', label: t('terms.panel.tabs.details') },
                                    { id: 'experiences', label: t('terms.panel.tabs.experiences') },
                                    { id: 'research', label: t('terms.panel.tabs.research') },
                                    { id: 'relations', label: t('terms.panel.tabs.relations') },
                                    { id: 'mentions', label: t('terms.panel.tabs.mentions') },
                                    { id: 'tracking', label: t('terms.panel.tabs.tracking') },
                                    { id: 'gallery', label: t('terms.panel.tabs.gallery') },
                                ] as const
                            ).map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        'text-sm px-1.5 py-2 border-b-2 transition-colors',
                                        activeTab === tab.id
                                            ? 'border-foreground text-foreground'
                                            : 'border-transparent text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" aria-label={t('terms.panel.actions.label')}>
                                    <MoreVertical className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" data-term-floating-panel="true" className="w-64">
                                <DropdownMenuLabel>{t('terms.panel.actions.color')}</DropdownMenuLabel>
                                {TERM_ENTRY_COLOR_IDS.map((id) => {
                                    const classes = getTermEntryColorClasses(id)
                                    const selected = colorId === id
                                    return (
                                        <DropdownMenuItem
                                            key={id}
                                            className="gap-3 py-2"
                                            onSelect={() => {
                                                onUpdate({ color: id === 'black' ? undefined : id })
                                            }}
                                        >
                                            <span
                                                className={cn(
                                                    'h-4 w-4 rounded-full border flex items-center justify-center',
                                                    classes.dot
                                                )}
                                            >
                                                {selected && <Check className={cn('h-3 w-3', id === 'black' ? 'text-background' : 'text-white')} />}
                                            </span>
                                            <span>{t(`terms.panel.colors.${id}`)}</span>
                                        </DropdownMenuItem>
                                    )
                                })}

                                <DropdownMenuSeparator />

                                <DropdownMenuItem onSelect={onArchive}>
                                    <Archive className="h-4 w-4" />
                                    <span>{t('terms.panel.actions.archive')}</span>
                                </DropdownMenuItem>

                                <DropdownMenuItem variant="destructive" disabled={hasProtectedContent} onSelect={onDelete}>
                                    <Trash2 className="h-4 w-4" />
                                    <span>{t('terms.panel.delete')}</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                <ScrollArea className="flex-1 min-h-0 min-w-0 overflow-x-hidden">
                    {activeTab === 'details' ? (
                        <div className="min-w-0 p-4 space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="term-panel-subtitle">{t('terms.fields.subtitle')}</Label>
                                <Input
                                    id="term-panel-subtitle"
                                    value={entry.subtitle ?? ''}
                                    placeholder={t('terms.subtitlePlaceholder')}
                                    onChange={(e) => onUpdate({ subtitle: e.target.value || undefined })}
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Label htmlFor="term-panel-aliases">{t('terms.panel.fields.aliases')}</Label>
                                </div>
                                <div className="text-xs text-muted-foreground">{t('terms.panel.fields.aliasesHelp')}</div>
                                <Input
                                    id="term-panel-aliases"
                                    value={entry.aliases ?? ''}
                                    placeholder={t('terms.panel.fields.aliasesPlaceholder')}
                                    onChange={(e) => onUpdate({ aliases: e.target.value || undefined })}
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Label htmlFor="term-panel-description">{t('terms.panel.fields.description')}</Label>
                                </div>
                                <MarkdownToolbarEditor
                                    id="term-panel-description"
                                    value={entry.description ?? ''}
                                    valueFormat="markdown"
                                    placeholder={t('terms.panel.fields.descriptionPlaceholder')}
                                    termMentionMatcher={termMentionMatcher}
                                    onTermMentionClick={handleTermMentionClick}
                                    onChange={(nextValue) => onUpdate({ description: nextValue || undefined })}
                                />
                                <div className="mt-4 space-y-2">
                                    <button
                                        type="button"
                                        className="flex w-full items-center justify-between rounded-md border bg-muted/10 px-3 py-2 text-left transition-colors hover:bg-muted/20"
                                        onClick={() =>
                                            setDescriptionPreviewEntryId((prev) => (prev === entry.id ? null : entry.id))
                                        }
                                        aria-expanded={descriptionPreviewOpen}
                                        aria-label={
                                            descriptionPreviewOpen
                                                ? t('terms.panel.fields.descriptionPreviewCollapse')
                                                : t('terms.panel.fields.descriptionPreviewExpand')
                                        }
                                    >
                                        <span className="text-sm font-medium">{t('terms.panel.fields.descriptionPreview')}</span>
                                        <span className="text-muted-foreground">
                                            {descriptionPreviewOpen ? (
                                                <ChevronDown className="h-4 w-4" />
                                            ) : (
                                                <ChevronRight className="h-4 w-4" />
                                            )}
                                        </span>
                                    </button>

                                    {descriptionPreviewOpen && (
                                        <div className="max-h-72 min-h-24 overflow-auto rounded-md border bg-muted/20 px-3 py-2">
                                            <TermEntryMarkdown content={entry.description} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : activeTab === 'experiences' ? (
                        <TermEntryExperiencesTab entry={entry} onUpdate={onUpdate} />
                    ) : activeTab === 'research' ? (
                        <TermEntryResearchTab
                            entry={entry}
                            activeTab={researchTab}
                            onTabChange={setResearchTab}
                            onUpdate={onUpdate}
                        />
                    ) : activeTab === 'relations' ? (
                        <TermEntryRelationsTab
                            entry={entry}
                            entries={entries}
                            categories={categories}
                            onAddRelation={onAddRelation}
                            onUpdateRelation={onUpdateRelation}
                            onDeleteRelation={onDeleteRelation}
                            onNavigateToEntry={(entryId) => onNavigateToEntry(entryId, 'relations')}
                        />
                    ) : activeTab === 'mentions' ? (
                        <TermEntryMentionsTab
                            mentionToken={{ termId: entry.id, colorId }}
                            manuscript={{
                                count: manuscriptMentionDetails.totalCount,
                                groups: manuscriptMentionDetails.groups,
                            }}
                            summaries={{
                                count: summaryMentionData.totalCount,
                                scenes: summaryMentionData.scenes,
                            }}
                            terms={{
                                count: termDescriptionMentionData.count,
                                mentions: termDescriptionMentionData.mentions,
                            }}
                            snippets={{
                                count: snippetMentionData.count,
                                mentions: snippetMentionData.mentions,
                                status: snippetsStatus,
                            }}
                            outlines={{
                                count: outlineMentionData.count,
                                mentions: outlineMentionData.mentions,
                                status: outlinesStatus,
                            }}
                            onNavigateToEntryMentions={(entryId) => onNavigateToEntry(entryId, 'mentions')}
                            onNavigateToSnippet={(snippetId) => onNavigateToSnippet?.(snippetId)}
                            onNavigateToOutline={(target) => onNavigateToOutline?.(target)}
                            onNavigate={(chapterId, sceneId, source) => {
                                if (!onNavigateToManuscript) return
                                onNavigateToManuscript(
                                    chapterId,
                                    sceneId,
                                    entry.id,
                                    source === 'summaries' ? 'summary' : 'manuscript'
                                )
                            }}
                        />
                    ) : activeTab === 'tracking' ? (
                        <TermEntryTrackingTab
                            value={entry.aiContextPolicy ?? 'detected'}
                            onChange={(next) => onUpdate({ aiContextPolicy: next })}
                        />
                    ) : activeTab === 'gallery' ? (
                        <TermEntryGalleryTab entry={entry} onUpdate={onUpdate} />
                    ) : (
                        <div className="p-6 text-sm text-muted-foreground">{t('terms.panel.comingSoon')}</div>
                    )}
                </ScrollArea>

                <TermMentionPreviewPopover
                    novelId={novelId}
                    open={Boolean(mentionPreview && mentionPreviewEntry)}
                    anchorEl={mentionPreview?.anchorEl ?? null}
                    entry={mentionPreviewEntry}
                    onClose={() => setMentionPreview(null)}
                />

                {footerField && (
                    <div className="border-t px-4 py-2 flex items-center justify-between text-sm text-muted-foreground">
                        <div>
                            {wordCount.toLocaleString()} {tCommon(wordCount === 1 ? 'word' : 'words')}
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1"
                                onClick={() => {
                                    setHistoryField(footerField)
                                    setHistoryOpen(true)
                                }}
                            >
                                <History className="h-4 w-4" />
                                {t('terms.panel.footer.history')}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1"
                                onClick={async () => {
                                    const text = footerValue ?? ''
                                    try {
                                        await navigator.clipboard.writeText(text)
                                        setCopied(true)
                                        window.setTimeout(() => setCopied(false), 1200)
                                    } catch {
                                        // Ignore
                                    }
                                }}
                            >
                                <Copy className="h-4 w-4" />
                                {copied ? t('terms.panel.footer.copied') : t('terms.panel.footer.copy')}
                            </Button>
                        </div>
                    </div>
                )}

                <TermEntryHistoryDialog
                    open={historyOpen}
                    onOpenChange={setHistoryOpen}
                    currentValue={currentHistoryValue}
                    historyItems={historyItems}
                    onRestore={(value) => {
                        if (historyField === 'description') {
                            const currentValue = (entry.description ?? '').trim()
                            const history = entry.history ?? []
                            const now = Date.now()
                            const { history: nextHistory } = recordRevisionHistory(history, currentValue, {
                                now,
                                idPrefix: 'term',
                                ignoreMinInterval: true,
                                normalize: (next) => next.trim(),
                            })
                            onUpdate({ description: value || undefined, history: nextHistory })
                            return
                        }

                        const currentValue = (entry.researchNotes ?? '').trim()
                        const history = entry.researchNotesHistory ?? []
                        const now = Date.now()
                        const { history: nextHistory } = recordRevisionHistory(history, currentValue, {
                            now,
                            idPrefix: 'term',
                            ignoreMinInterval: true,
                            normalize: (next) => next.trim(),
                        })
                        onUpdate({ researchNotes: value || undefined, researchNotesHistory: nextHistory })
                    }}
                />
            </div>
        </div>,
        document.body
    )
}
