import { useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Pin } from 'lucide-react'
import type { ManuscriptMentionGroup, SummaryMentionScene } from '@/components/editor/terms/manuscript-mentions'
import type { TermDescriptionMention } from '@/components/editor/terms/term-description-mentions'
import type { SnippetMention } from '@/components/editor/terms/snippet-mentions'
import type { OutlineMention } from '@/components/editor/terms/outline-mentions'
import { getMentionDecoration, type TermMentionToken } from '@/components/editor/terms/term-mentions-utils'
import { getTermEntryColorClasses } from '@/components/editor/terms/term-entry-colors'

type MentionSourceId = 'manuscript' | 'summaries' | 'terms' | 'snippets' | 'outlines'
type MentionNavigateSourceId = 'manuscript' | 'summaries'

type MentionSourceData = {
    count: number
    groups: ManuscriptMentionGroup[]
}

type SummarySourceData = {
    count: number
    scenes: SummaryMentionScene[]
}

type TermSourceData = {
    count: number
    mentions: TermDescriptionMention[]
}

type SnippetSourceData = {
    count: number
    mentions: SnippetMention[]
    status?: 'idle' | 'loading' | 'loaded' | 'error'
}

type OutlineSourceData = {
    count: number
    mentions: OutlineMention[]
    status?: 'idle' | 'loading' | 'loaded' | 'error'
}

type TermEntryMentionsTabProps = {
    mentionToken: TermMentionToken
    manuscript: MentionSourceData
    summaries: SummarySourceData
    terms: TermSourceData
    snippets: SnippetSourceData
    outlines: OutlineSourceData
    onNavigateToEntryMentions: (entryId: string) => void
    onNavigateToSnippet: (snippetId: string) => void
    onNavigateToOutline?: (target: { kind: 'act'; actNumber: number } | { kind: 'chapter'; chapterId: string }) => void
    onNavigate: (chapterId: string, sceneId: string | undefined, source: MentionNavigateSourceId) => void
}

export function TermEntryMentionsTab({
    mentionToken,
    manuscript,
    summaries,
    terms,
    snippets,
    outlines,
    onNavigateToEntryMentions,
    onNavigateToSnippet,
    onNavigateToOutline,
    onNavigate,
}: TermEntryMentionsTabProps) {
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const [activeSource, setActiveSource] = useState<MentionSourceId>('manuscript')
    const [expandedBySource, setExpandedBySource] = useState<Record<MentionSourceId, Set<string>>>(() => ({
        manuscript: new Set(),
        summaries: new Set(),
        terms: new Set(),
        snippets: new Set(),
        outlines: new Set(),
    }))
    const [shownCountBySourceAndChapterId, setShownCountBySourceAndChapterId] = useState<
        Record<MentionSourceId, Record<string, number>>
    >(() => ({
        manuscript: {},
        summaries: {},
        terms: {},
        snippets: {},
        outlines: {},
    }))

    const sortedManuscriptGroups = useMemo(() => {
        return manuscript.groups
            .slice()
            .sort((a, b) => a.chapterIndex - b.chapterIndex || a.chapterTitle.localeCompare(b.chapterTitle))
    }, [manuscript.groups])

    const sortedSummaryScenes = useMemo(() => {
        return summaries.scenes
            .slice()
            .sort((a, b) => a.chapterIndex - b.chapterIndex || a.sceneNumber - b.sceneNumber)
    }, [summaries.scenes])

    const expanded = expandedBySource[activeSource]
    const shownCountByChapterId = shownCountBySourceAndChapterId[activeSource]
    const emptyLabel =
        activeSource === 'manuscript'
            ? t('terms.panel.mentions.emptyManuscript')
            : activeSource === 'summaries'
                ? t('terms.panel.mentions.emptySummaries')
                : activeSource === 'snippets'
                    ? t('terms.panel.mentions.emptySnippets')
                    : activeSource === 'outlines'
                        ? t('terms.panel.mentions.emptyOutlines')
                : t('terms.panel.mentions.emptyTerms')

    const activeCount =
        activeSource === 'manuscript'
            ? manuscript.count
            : activeSource === 'summaries'
                ? summaries.count
                : activeSource === 'snippets'
                    ? snippets.count
                    : activeSource === 'outlines'
                        ? outlines.count
                    : terms.count

    const snippetStatus = snippets.status ?? 'loaded'
    const outlineStatus = outlines.status ?? 'loaded'

    const renderSummaryText = (text: string, matches: SummaryMentionScene['matches']) => {
        if (matches.length === 0) return <span>{text}</span>

        const decoration = getMentionDecoration(mentionToken)
        const parts: ReactNode[] = []
        let cursor = 0

        matches.forEach((m, idx) => {
            const start = Math.max(0, Math.min(text.length, m.start))
            const end = Math.max(start, Math.min(text.length, m.end))
            if (start > cursor) {
                parts.push(<span key={`t-${idx}`}>{text.slice(cursor, start)}</span>)
            }
            parts.push(
                <span
                    key={`m-${idx}`}
                    className={decoration.className}
                    style={decoration.reactStyle}
                    data-term-id={mentionToken.termId}
                    data-term-mention="true"
                >
                    {text.slice(start, end)}
                </span>
            )
            cursor = end
        })

        if (cursor < text.length) {
            parts.push(<span key="t-end">{text.slice(cursor)}</span>)
        }

        return parts
    }

    return (
        <div className="p-4 space-y-3">
            <div className="flex items-center gap-4 border-b pb-2 overflow-x-auto">
                {(
                    [
                        { id: 'manuscript' as const, label: t('terms.panel.mentions.sources.manuscript'), count: manuscript.count },
                        { id: 'summaries' as const, label: t('terms.panel.mentions.sources.summaries'), count: summaries.count },
                        { id: 'terms' as const, label: t('terms.panel.mentions.sources.terms'), count: terms.count },
                        { id: 'snippets' as const, label: t('terms.panel.mentions.sources.snippets'), count: snippets.count },
                        { id: 'outlines' as const, label: t('terms.panel.mentions.sources.outlines'), count: outlines.count },
                    ] as const
                ).map((source) => (
                    <button
                        key={source.id}
                        type="button"
                        onClick={() => setActiveSource(source.id)}
                        className={cn(
                            'flex items-center gap-2 whitespace-nowrap px-1.5 pb-2 text-sm border-b-2 transition-colors',
                            activeSource === source.id
                                ? 'border-foreground text-foreground'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <span className="font-medium">{source.label}</span>
                        <Badge variant="secondary" className="text-xs">
                            {source.count.toLocaleString()}
                        </Badge>
                    </button>
                ))}
            </div>

            {activeSource === 'snippets' && snippetStatus !== 'loaded' ? (
                <div className="rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground flex items-center gap-2">
                    {snippetStatus === 'error' ? (
                        tCommon('operationFailed')
                    ) : (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {tCommon('loading')}
                        </>
                    )}
                </div>
            ) : activeSource === 'outlines' && outlineStatus !== 'loaded' ? (
                <div className="rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground flex items-center gap-2">
                    {outlineStatus === 'error' ? (
                        tCommon('operationFailed')
                    ) : (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {tCommon('loading')}
                        </>
                    )}
                </div>
            ) : activeCount === 0 ? (
                <div className="rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground">{emptyLabel}</div>
            ) : activeSource === 'summaries' ? (
                <div className="space-y-2">
                    {sortedSummaryScenes.map((scene) => (
                        <div key={scene.sceneId} className="rounded-lg border bg-card overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2">
                                <div className="min-w-0 flex-1 font-medium truncate">
                                    {t('terms.panel.mentions.chapterLabel', { number: scene.chapterIndex })}: {scene.chapterTitle} -{' '}
                                    {t('terms.panel.mentions.sceneLabel', { number: scene.sceneNumber })}
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1 shrink-0"
                                    onClick={() => onNavigate(scene.chapterId, scene.sceneId, 'summaries')}
                                >
                                    <ExternalLink className="h-4 w-4" />
                                    {t('terms.panel.mentions.open')}
                                </Button>
                            </div>
                            <div className="border-t bg-muted/10 p-3">
                                <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                                    {renderSummaryText(scene.summary, scene.matches)}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : activeSource === 'snippets' ? (
                <div className="space-y-2">
                    {snippets.mentions.map((mention) => {
                        const decoration = getMentionDecoration(mentionToken)
                        return (
                            <div key={mention.snippetId} className="rounded-lg border bg-card overflow-hidden">
                                <div className="flex items-center gap-2 px-3 py-2">
                                    <div className="min-w-0 flex-1 font-medium truncate">
                                        {mention.snippetTitle || t('snippets.untitled')}
                                    </div>
                                    {mention.snippetPinned && (
                                        <Pin className="h-4 w-4 text-muted-foreground shrink-0" />
                                    )}
                                    <Badge variant="secondary" className="text-xs shrink-0">
                                        {mention.count.toLocaleString()}
                                    </Badge>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="gap-1 shrink-0"
                                        onClick={() => onNavigateToSnippet(mention.snippetId)}
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        {t('terms.panel.mentions.open')}
                                    </Button>
                                </div>

                                <div className="border-t bg-muted/10 p-3">
                                    <div className="text-sm leading-relaxed text-foreground">
                                        {mention.prefixEllipsis && <span className="text-muted-foreground">...</span>}
                                        <span>{mention.before}</span>
                                        <span
                                            className={decoration.className}
                                            style={decoration.reactStyle}
                                            data-term-id={mentionToken.termId}
                                            data-term-mention="true"
                                        >
                                            {mention.match}
                                        </span>
                                        <span>{mention.after}</span>
                                        {mention.suffixEllipsis && <span className="text-muted-foreground">...</span>}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : activeSource === 'outlines' ? (
                <div className="space-y-2">
                    {outlines.mentions.map((mention) => {
                        const decoration = getMentionDecoration(mentionToken)
                        const isAct = mention.outlineType === 'ACT'
                        const title = isAct
                            ? t('act.defaultTitle', { number: mention.actNumber ?? 1 })
                            : (() => {
                                const label =
                                    typeof mention.chapterIndex === 'number' && mention.chapterIndex > 0
                                        ? t('terms.panel.mentions.chapterLabel', { number: mention.chapterIndex })
                                        : t('chapter.label')
                                const chapterTitle = mention.chapterTitle ?? ''
                                return chapterTitle ? `${label}: ${chapterTitle}` : label
                            })()

                        const canOpen =
                            Boolean(onNavigateToOutline) &&
                            (isAct ? typeof mention.actNumber === 'number' : Boolean(mention.chapterId))

                        return (
                            <div key={mention.outlineId} className="rounded-lg border bg-card overflow-hidden">
                                <div className="flex items-center gap-2 px-3 py-2">
                                    <div className="min-w-0 flex-1 font-medium truncate">{title}</div>
                                    <Badge variant="secondary" className="text-xs shrink-0">
                                        {mention.count.toLocaleString()}
                                    </Badge>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="gap-1 shrink-0"
                                        onClick={() => {
                                            if (!onNavigateToOutline) return
                                            if (isAct && typeof mention.actNumber === 'number') {
                                                onNavigateToOutline({ kind: 'act', actNumber: mention.actNumber })
                                                return
                                            }
                                            if (!isAct && mention.chapterId) {
                                                onNavigateToOutline({ kind: 'chapter', chapterId: mention.chapterId })
                                            }
                                        }}
                                        disabled={!canOpen}
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        {t('terms.panel.mentions.open')}
                                    </Button>
                                </div>

                                <div className="border-t bg-muted/10 p-3">
                                    <div className="text-sm leading-relaxed text-foreground">
                                        {mention.prefixEllipsis && <span className="text-muted-foreground">...</span>}
                                        <span>{mention.before}</span>
                                        <span
                                            className={decoration.className}
                                            style={decoration.reactStyle}
                                            data-term-id={mentionToken.termId}
                                            data-term-mention="true"
                                        >
                                            {mention.match}
                                        </span>
                                        <span>{mention.after}</span>
                                        {mention.suffixEllipsis && <span className="text-muted-foreground">...</span>}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : activeSource === 'terms' ? (
                <div className="space-y-2">
                    {terms.mentions.map((mention) => {
                        const decoration = getMentionDecoration(mentionToken)
                        const titleClasses = getTermEntryColorClasses(mention.entryColorId)
                        const titleAccent = mention.entryColorId !== 'black'

                        return (
                            <div key={mention.entryId} className="rounded-lg border bg-card overflow-hidden">
                                <div className="flex items-center gap-2 px-3 py-2">
                                    <div className={cn('min-w-0 flex-1 font-medium truncate', titleAccent && titleClasses.text)}>
                                        {mention.entryTitle}
                                    </div>
                                    <Badge variant="secondary" className="text-xs shrink-0">
                                        {mention.count.toLocaleString()}
                                    </Badge>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="gap-1 shrink-0"
                                        onClick={() => onNavigateToEntryMentions(mention.entryId)}
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        {t('terms.panel.mentions.open')}
                                    </Button>
                                </div>

                                <div className="border-t bg-muted/10 p-3">
                                    <div className="text-sm leading-relaxed text-foreground">
                                        {mention.prefixEllipsis && <span className="text-muted-foreground">...</span>}
                                        <span>{mention.before}</span>
                                        <span
                                            className={decoration.className}
                                            style={decoration.reactStyle}
                                            data-term-id={mentionToken.termId}
                                            data-term-mention="true"
                                        >
                                            {mention.match}
                                        </span>
                                        <span>{mention.after}</span>
                                        {mention.suffixEllipsis && <span className="text-muted-foreground">...</span>}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : (
                <div className="space-y-2">
                    {sortedManuscriptGroups.map((group) => {
                        const decoration = getMentionDecoration(mentionToken)
                        const isExpanded = expanded.has(group.chapterId)
                        const shown = shownCountByChapterId[group.chapterId] ?? 3
                        const visibleMentions = isExpanded ? group.mentions.slice(0, shown) : group.mentions.slice(0, 1)
                        const hasMore = isExpanded && group.mentions.length > shown

                        return (
                            <div key={group.chapterId} className="rounded-lg border bg-card overflow-hidden">
                                <div
                                    className={cn(
                                        'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors'
                                    )}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                        setExpandedBySource((prev) => {
                                            const nextForSource = new Set(prev[activeSource])
                                            if (nextForSource.has(group.chapterId)) nextForSource.delete(group.chapterId)
                                            else nextForSource.add(group.chapterId)
                                            return { ...prev, [activeSource]: nextForSource }
                                        })
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            setExpandedBySource((prev) => {
                                                const nextForSource = new Set(prev[activeSource])
                                                if (nextForSource.has(group.chapterId)) nextForSource.delete(group.chapterId)
                                                else nextForSource.add(group.chapterId)
                                                return { ...prev, [activeSource]: nextForSource }
                                            })
                                        }
                                    }}
                                >
                                    {isExpanded ? (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    )}

                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="font-medium truncate">
                                                {t('terms.panel.mentions.chapterLabel', { number: group.chapterIndex })}:{' '}
                                                {group.chapterTitle}
                                            </div>
                                            <Badge variant="secondary" className="text-xs shrink-0">
                                                {group.count.toLocaleString()}
                                            </Badge>
                                        </div>
                                    </div>

                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="gap-1"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            const first = group.mentions[0]
                                            onNavigate(group.chapterId, first?.sceneId, 'manuscript')
                                        }}
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        {t('terms.panel.mentions.open')}
                                    </Button>
                                </div>

                                <div className="border-t bg-muted/10">
                                    <div className="p-3 space-y-2">
                                        {visibleMentions.map((mention, idx) => (
                                            <button
                                                key={`${mention.sceneId}:${mention.sceneNumber}:${idx}`}
                                                type="button"
                                                className="w-full text-left rounded-md border bg-background px-3 py-2 hover:bg-muted/30 transition-colors"
                                                onClick={() => onNavigate(group.chapterId, mention.sceneId, 'manuscript')}
                                            >
                                                <div className="text-xs text-muted-foreground mb-1">
                                                    {t('terms.panel.mentions.sceneLabel', { number: mention.sceneNumber })}
                                                </div>
                                                <div className="text-sm leading-relaxed text-foreground">
                                                    {mention.prefixEllipsis && <span className="text-muted-foreground">...</span>}
                                                    <span>{mention.before}</span>
                                                    <span
                                                        className={decoration.className}
                                                        style={decoration.reactStyle}
                                                        data-term-id={mentionToken.termId}
                                                        data-term-mention="true"
                                                    >
                                                        {mention.match}
                                                    </span>
                                                    <span>{mention.after}</span>
                                                    {mention.suffixEllipsis && <span className="text-muted-foreground">...</span>}
                                                </div>
                                            </button>
                                        ))}

                                        {isExpanded && (group.mentions.length > 1 || group.mentions.length > shown) && (
                                            <div className="flex items-center justify-between">
                                                <div className="text-xs text-muted-foreground">
                                                    {t('terms.panel.mentions.showing', {
                                                        shown: Math.min(shown, group.mentions.length),
                                                        total: group.mentions.length,
                                                    })}
                                                </div>
                                                {hasMore && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                            setShownCountBySourceAndChapterId((prev) => ({
                                                                ...prev,
                                                                [activeSource]: {
                                                                    ...prev[activeSource],
                                                                    [group.chapterId]: (prev[activeSource][group.chapterId] ?? 3) + 10,
                                                                },
                                                            }))
                                                        }}
                                                    >
                                                        {t('terms.panel.mentions.loadMore')}
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
