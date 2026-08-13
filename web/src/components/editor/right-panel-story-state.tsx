'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Database, Loader2, RefreshCw, Search, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    storyStateApi,
    type StoryStateView,
    type StoryStateViewResponse,
} from '@/lib/api'
import { cn } from '@/lib/utils'

const STORY_STATE_VIEWS: StoryStateView[] = [
    'moments',
    'episodes',
    'entities',
    'aliases',
    'facts',
    'evidence',
]

type StoryStateRow = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function text(record: Record<string, unknown> | null, key: string) {
    const value = record?.[key]
    return typeof value === 'string' ? value : ''
}

function count(record: Record<string, unknown> | null, key: string) {
    const value = record?.[key]
    return typeof value === 'number' ? value : 0
}

function episodeStatusKey(row: StoryStateRow) {
    const status = text(row, 'syncStatus')
    if (status === 'outdated') return 'storyState.outdated'
    if (status === 'source_empty') return 'storyState.sourceEmpty'
    if (status === 'inactive' || Boolean(row.inactiveAt)) return 'storyState.inactive'
    return 'storyState.active'
}

function episodeStatusVariant(row: StoryStateRow): 'default' | 'secondary' | 'outline' {
    const status = text(row, 'syncStatus')
    if (status === 'outdated' || status === 'source_empty') return 'outline'
    if (status === 'inactive' || Boolean(row.inactiveAt)) return 'secondary'
    return 'default'
}

function RowId({ row }: { row: StoryStateRow }) {
    return <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground">{text(row, 'id')}</div>
}

function StoryStateRowCard({
    view,
    row,
    formatDate,
    t,
}: {
    view: StoryStateView
    row: StoryStateRow
    formatDate: (value: string) => string
    t: (key: string, values?: Record<string, string | number>) => string
}) {
    if (view === 'moments') {
        const sourceScene = asRecord(row.sourceScene)
        const chapter = asRecord(sourceScene?.chapter)
        const counts = asRecord(row._count)
        return (
            <div className="rounded-md border bg-card p-3">
                <div className="flex items-start gap-2">
                    <Badge variant="outline" className="tabular-nums">{count(row, 'storyOrder')}</Badge>
                    <div className="min-w-0 flex-1 font-medium">{text(row, 'label')}</div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                    {chapter ? `${text(chapter, 'title')} · ` : ''}
                    {t('storyState.references', {
                        episodes: count(counts, 'episodes'),
                        facts: count(counts, 'factsStarting') + count(counts, 'factsEnding'),
                    })}
                </div>
                <RowId row={row} />
            </div>
        )
    }

    if (view === 'episodes') {
        const referenceMoment = asRecord(row.referenceMoment)
        const sourceScene = asRecord(row.sourceScene)
        const chapter = asRecord(sourceScene?.chapter)
        const counts = asRecord(row._count)
        return (
            <div className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{text(row, 'sourceKind')}</Badge>
                    <Badge variant={episodeStatusVariant(row)}>
                        {t(episodeStatusKey(row))}
                    </Badge>
                </div>
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm">{text(row, 'content')}</p>
                <div className="mt-2 text-xs text-muted-foreground">
                    {referenceMoment ? `${text(referenceMoment, 'label')} · ` : ''}
                    {chapter ? `${text(chapter, 'title')} · ` : ''}
                    {t('storyState.evidenceCount', { count: count(counts, 'evidence') })}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">{formatDate(text(row, 'createdAt'))}</div>
                <RowId row={row} />
            </div>
        )
    }

    if (view === 'entities') {
        const aliases = Array.isArray(row.aliases) ? row.aliases.map(asRecord).filter(Boolean) : []
        const counts = asRecord(row._count)
        return (
            <div className="rounded-md border bg-card p-3">
                <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate font-medium">{text(row, 'name')}</div>
                    <Badge variant="outline">{text(row, 'kind')}</Badge>
                </div>
                {text(row, 'summary') && <p className="mt-2 whitespace-pre-wrap text-sm">{text(row, 'summary')}</p>}
                {aliases.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                        {t('storyState.aliasList', { aliases: aliases.map((alias) => text(alias, 'alias')).join('、') })}
                    </div>
                )}
                <div className="mt-2 text-xs text-muted-foreground">
                    {t('storyState.factCount', {
                        count: count(counts, 'subjectFacts') + count(counts, 'objectFacts'),
                    })}
                </div>
                <RowId row={row} />
            </div>
        )
    }

    if (view === 'aliases') {
        const entity = asRecord(row.entity)
        return (
            <div className="rounded-md border bg-card p-3">
                <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate font-medium">{text(row, 'alias')}</div>
                    <Badge variant="outline">{text(row, 'sourceKind')}</Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                    → {text(entity, 'name')} · {text(entity, 'kind')}
                </div>
                <RowId row={row} />
            </div>
        )
    }

    if (view === 'facts') {
        const subject = asRecord(row.subjectEntity)
        const object = asRecord(row.objectEntity)
        const from = asRecord(row.validFromMoment)
        const to = asRecord(row.validToMoment)
        const evidence = Array.isArray(row.evidence) ? row.evidence : []
        return (
            <div className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={row.credible === true ? 'default' : 'secondary'}>
                        {t(row.credible === true ? 'storyState.credible' : 'storyState.notCredible')}
                    </Badge>
                    {row.staleCredible === true ? <Badge variant="outline">{t('storyState.staleCredible')}</Badge> : null}
                    <Badge variant="outline">{text(row, 'predicateKey')}</Badge>
                </div>
                <div className="mt-2 text-sm font-medium">
                    {text(subject, 'name')} → {text(object, 'name') || text(row, 'objectValue')}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{text(row, 'factText')}</p>
                <div className="mt-2 text-xs text-muted-foreground">
                    [{text(from, 'label') || '…'}, {text(to, 'label') || '…'}) · {t('storyState.evidenceCount', { count: evidence.length })}
                </div>
                <RowId row={row} />
            </div>
        )
    }

    const fact = asRecord(row.fact)
    const episode = asRecord(row.episode)
    return (
        <div className="rounded-md border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant={text(row, 'role') === 'SUPPORTS' ? 'default' : 'secondary'}>{text(row, 'role')}</Badge>
                <Badge variant="outline">{text(episode, 'sourceKind')}</Badge>
                {episode?.inactiveAt ? <Badge variant="secondary">{t('storyState.inactive')}</Badge> : null}
                {text(episode, 'syncStatus') === 'outdated' ? <Badge variant="outline">{t('storyState.outdated')}</Badge> : null}
                {text(episode, 'syncStatus') === 'source_empty' ? <Badge variant="outline">{t('storyState.sourceEmpty')}</Badge> : null}
            </div>
            <p className="mt-2 text-sm">{text(fact, 'factText')}</p>
            <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
                {text(fact, 'id')} · {text(episode, 'id')}
            </div>
        </div>
    )
}

export function RightPanelStoryState({ novelId }: { novelId?: string }) {
    const t = useTranslations('editor.infoPanel')
    const locale = useLocale()
    const [view, setView] = useState<StoryStateView>('moments')
    const [query, setQuery] = useState('')
    const [debouncedQuery, setDebouncedQuery] = useState('')
    const [data, setData] = useState<StoryStateViewResponse | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(false)
    const requestIdRef = useRef(0)
    const formatDate = useMemo(() => {
        const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
        return (value: string) => value ? formatter.format(new Date(value)) : ''
    }, [locale])

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
        return () => window.clearTimeout(timer)
    }, [query])

    useEffect(() => {
        setData(null)
    }, [novelId, view])

    const load = useCallback(async () => {
        if (!novelId) return
        const requestId = ++requestIdRef.current
        setLoading(true)
        setError(false)
        try {
            const next = await storyStateApi.view(novelId, view, debouncedQuery)
            if (requestId !== requestIdRef.current) return
            setData(next)
        } catch (loadError) {
            if (requestId !== requestIdRef.current) return
            console.error('Failed to load Story State:', loadError)
            setError(true)
        } finally {
            if (requestId === requestIdRef.current) setLoading(false)
        }
    }, [debouncedQuery, novelId, view])

    useEffect(() => {
        void load()
    }, [load])

    if (!novelId) {
        return <div className="p-4 text-sm text-muted-foreground">{t('storyState.noNovel')}</div>
    }

    const total = data?.total ?? 0
    const matched = data?.matched ?? total
    const searching = Boolean(debouncedQuery)

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="border-b p-2">
                <div className="grid grid-cols-3 gap-1">
                    {STORY_STATE_VIEWS.map((item) => (
                        <Button
                            key={item}
                            variant={view === item ? 'secondary' : 'ghost'}
                            size="sm"
                            className="h-7 px-1 text-xs"
                            onClick={() => setView(item)}
                        >
                            {t(`storyState.views.${item}`)}
                        </Button>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-2 border-b px-3 py-2">
                <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Database className="h-3.5 w-3.5 shrink-0" />
                    <span className="whitespace-nowrap tabular-nums">
                        {searching
                            ? t('storyState.matchCount', { matched, total })
                            : t('storyState.rowCount', { count: total })}
                    </span>
                </div>
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t('storyState.searchPlaceholder')}
                        className="h-7 pl-7 pr-7 text-xs"
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => {
                                setQuery('')
                                setDebouncedQuery('')
                            }}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label={t('storyState.clearSearch')}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => void load()} disabled={loading} title={t('storyState.refresh')}>
                    <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
                {loading && !data ? (
                    <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
                ) : error ? (
                    <div className="p-4 text-sm text-destructive">{t('storyState.loadError')}</div>
                ) : !data || data.rows.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">{searching ? t('storyState.noMatch') : t('storyState.empty')}</div>
                ) : (
                    <div className="space-y-2 p-3">
                        {data.rows.map((row, index) => (
                            <StoryStateRowCard
                                key={text(row, 'id') || `${view}-${index}`}
                                view={view}
                                row={row}
                                formatDate={formatDate}
                                t={t}
                            />
                        ))}
                    </div>
                )}
            </ScrollArea>
        </div>
    )
}
