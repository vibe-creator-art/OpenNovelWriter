'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    Activity,
    ArrowRight,
    BookOpenText,
    ChevronLeft,
    ChevronRight,
    CircleStop,
    Clock3,
    Eye,
    Filter,
    GitBranch,
    Network,
    Orbit,
    Pause,
    Play,
    RadioTower,
    RefreshCw,
    Search,
    Sparkles,
    TimerOff,
    UsersRound,
    X,
    Zap,
} from 'lucide-react'

import { StoryStateGraph } from '@/components/editor/story-state-graph'
import { StoryStateTimeline } from '@/components/editor/story-state-timeline'
import {
    getStoryFactMomentState,
    resolveStoryFacts,
    storyFactMatchesSearch,
    storyFactTouchesEntity,
} from '@/components/editor/story-state-visualization-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    storyStateApi,
    type StoryStateVisualizationData,
    type StoryStateVisualizationEpisode,
    type StoryStateVisualizationFact,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type StoryStateMode = 'graph' | 'timeline'

function episodeSourceLabel(episode: StoryStateVisualizationEpisode, manualLabel: string, sceneLabel: string) {
    if (episode.sourceKind === 'MANUAL') return manualLabel
    if (episode.sourceKind === 'SCENE_SUMMARY') return sceneLabel
    return episode.sourceKind
}

function episodeSyncLabel(episode: StoryStateVisualizationEpisode, t: (key: string) => string) {
    if (episode.syncStatus === 'outdated') return t('outdatedSource')
    if (episode.syncStatus === 'source_empty') return t('emptySummarySource')
    if (episode.inactiveAt || episode.syncStatus === 'inactive') return t('inactiveSource')
    return null
}

export function MiddlePanelStoryState({
    novelId,
    onNavigateToScene,
}: {
    novelId: string
    onNavigateToScene: (chapterId: string, sceneId: string) => void
}) {
    const t = useTranslations('editor.storyStateDashboard')
    const [data, setData] = useState<StoryStateVisualizationData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [mode, setMode] = useState<StoryStateMode>('graph')
    const [selectedMomentIndex, setSelectedMomentIndex] = useState(0)
    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
    const [selectedFactId, setSelectedFactId] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [kindFilter, setKindFilter] = useState('ALL')
    const [playing, setPlaying] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const next = await storyStateApi.visualization(novelId)
            setData(next)
            setSelectedMomentIndex(Math.max(0, next.moments.length - 1))
            setSelectedEntityId(null)
            setSelectedFactId(null)
        } catch (reason) {
            console.error('Failed to load Story State visualization:', reason)
            setError(reason instanceof Error ? reason.message : t('loadError'))
        } finally {
            setLoading(false)
        }
    }, [novelId, t])

    useEffect(() => { void load() }, [load])

    useEffect(() => {
        if (!playing || !data || data.moments.length < 2) return
        const timer = window.setInterval(() => {
            setSelectedMomentIndex((current) => Math.min(current + 1, data.moments.length - 1))
        }, 1100)
        return () => window.clearInterval(timer)
    }, [data, playing])

    useEffect(() => {
        if (data && selectedMomentIndex >= data.moments.length - 1) setPlaying(false)
    }, [data, selectedMomentIndex])

    const moments = useMemo(() => data?.moments ?? [], [data?.moments])
    const entities = useMemo(() => data?.entities ?? [], [data?.entities])
    const episodes = useMemo(() => data?.episodes ?? [], [data?.episodes])
    const resolvedFacts = useMemo(() => resolveStoryFacts(data?.facts ?? [], moments), [data?.facts, moments])
    const credibleFacts = useMemo(() => resolvedFacts.filter((fact) => fact.credible), [resolvedFacts])
    const selectedMoment = moments[selectedMomentIndex] ?? null
    const entityById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity] as const)), [entities])
    const episodeById = useMemo(() => new Map(episodes.map((episode) => [episode.id, episode] as const)), [episodes])
    const entityNames = useMemo(() => new Map(entities.map((entity) => [entity.id, entity.name] as const)), [entities])
    const selectedEntity = selectedEntityId ? entityById.get(selectedEntityId) ?? null : null
    const selectedFact = selectedFactId ? resolvedFacts.find((fact) => fact.id === selectedFactId) ?? null : null

    const factStates = useMemo(() => new Map(credibleFacts.map((fact) => [fact.id, getStoryFactMomentState(fact, selectedMoment)] as const)), [credibleFacts, selectedMoment])
    const activeFacts = useMemo(() => credibleFacts.filter((fact) => {
        const state = factStates.get(fact.id)
        return state === 'active' || state === 'starts'
    }), [credibleFacts, factStates])
    const startingFacts = useMemo(() => credibleFacts.filter((fact) => factStates.get(fact.id) === 'starts'), [credibleFacts, factStates])
    const endingFacts = useMemo(() => credibleFacts.filter((fact) => factStates.get(fact.id) === 'ends'), [credibleFacts, factStates])
    const activeEntityIds = useMemo(() => new Set(activeFacts.flatMap((fact) => [fact.subjectEntityId, fact.objectEntityId].filter((id): id is string => Boolean(id)))), [activeFacts])

    const availableKinds = useMemo(() => Array.from(new Set(entities.map((entity) => entity.kind))).sort(), [entities])
    const directMatchingEntityIds = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase()
        if (!normalized) return new Set(entities.map((entity) => entity.id))
        return new Set(entities.filter((entity) => [
            entity.name,
            entity.summary ?? '',
            ...entity.aliases.map((alias) => alias.alias),
        ].some((value) => value.toLocaleLowerCase().includes(normalized))).map((entity) => entity.id))
    }, [entities, query])
    const searchMatchingFacts = useMemo(() => credibleFacts.filter((fact) => storyFactMatchesSearch(fact, query, entityNames)), [credibleFacts, entityNames, query])
    const searchContextEntityIds = useMemo(() => new Set([
        ...directMatchingEntityIds,
        ...searchMatchingFacts.flatMap((fact) => [fact.subjectEntityId, fact.objectEntityId].filter((id): id is string => Boolean(id))),
    ]), [directMatchingEntityIds, searchMatchingFacts])
    const visibleEntities = useMemo(() => entities.filter((entity) =>
        (kindFilter === 'ALL' || entity.kind === kindFilter)
        && (!query.trim() || searchContextEntityIds.has(entity.id))), [entities, kindFilter, query, searchContextEntityIds])
    const visibleEntityIds = useMemo(() => new Set(visibleEntities.map((entity) => entity.id)), [visibleEntities])
    const visibleFacts = useMemo(() => credibleFacts.filter((fact) => {
        const matchesQuery = !query.trim()
            || storyFactMatchesSearch(fact, query, entityNames)
            || directMatchingEntityIds.has(fact.subjectEntityId)
            || Boolean(fact.objectEntityId && directMatchingEntityIds.has(fact.objectEntityId))
        const matchesKind = kindFilter === 'ALL'
            || visibleEntityIds.has(fact.subjectEntityId)
            || Boolean(fact.objectEntityId && visibleEntityIds.has(fact.objectEntityId))
        return matchesQuery && matchesKind
    }), [credibleFacts, directMatchingEntityIds, entityNames, kindFilter, query, visibleEntityIds])

    const selectedEntityCurrentFacts = useMemo(() => selectedEntityId
        ? activeFacts.filter((fact) => storyFactTouchesEntity(fact, selectedEntityId))
        : [], [activeFacts, selectedEntityId])
    const momentEpisodes = useMemo(() => selectedMoment
        ? episodes.filter((episode) => episode.referenceMomentId === selectedMoment.id)
        : episodes.filter((episode) => episode.referenceMomentId === null), [episodes, selectedMoment])
    const hasStoryState = moments.length > 0 || entities.length > 0 || resolvedFacts.length > 0 || episodes.length > 0

    const selectMomentIndex = useCallback((index: number) => {
        setPlaying(false)
        setSelectedMomentIndex(Math.max(0, Math.min(index, moments.length - 1)))
    }, [moments.length])

    const renderFactLine = (fact: StoryStateVisualizationFact, tone: 'starts' | 'ends' | 'active') => {
        const subject = entityById.get(fact.subjectEntityId)
        const object = fact.objectEntityId ? entityById.get(fact.objectEntityId) : null
        return (
            <button
                key={fact.id}
                type="button"
                onClick={() => {
                    setSelectedEntityId(null)
                    setSelectedFactId(fact.id)
                }}
                className={cn(
                    'w-full rounded-xl border border-ss-border bg-ss-fill p-3 text-left transition-colors hover:bg-ss-fill-hover',
                    tone === 'starts' && 'border-ss-starts-border bg-ss-starts-fill',
                    tone === 'ends' && 'border-ss-ends-border bg-ss-ends-fill'
                )}
            >
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-ss-text-muted">
                    <span className={cn('h-1.5 w-1.5 rounded-full bg-ss-accent', tone === 'starts' && 'bg-ss-starts', tone === 'ends' && 'bg-ss-ends')} />
                    {fact.predicateKey}
                    {fact.staleCredible ? <span className="ml-auto normal-case tracking-normal text-ss-text-faint">{t('staleCredible')}</span> : null}
                </div>
                <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-ss-text-secondary">
                    <span className="truncate">{subject?.name}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-ss-text-faint" />
                    <span className="truncate">{object?.name ?? fact.objectValue}</span>
                </div>
            </button>
        )
    }

    if (loading && !data) {
        return (
            <div className="onw-story-state-shell relative flex h-full min-h-[620px] items-center justify-center overflow-hidden">
                <div className="relative z-10 text-center">
                    <Orbit className="mx-auto h-10 w-10 animate-spin text-ss-accent [animation-duration:3s]" />
                    <div className="mt-4 text-sm tracking-wide">{t('loading')}</div>
                </div>
            </div>
        )
    }

    if (error || !data) {
        return (
            <div className="onw-story-state-shell relative flex h-full min-h-[620px] items-center justify-center overflow-hidden px-6 text-center">
                <div className="relative z-10">
                    <TimerOff className="mx-auto h-10 w-10 text-ss-ends" />
                    <div className="mt-4 text-sm text-ss-ends-text">{error || t('loadError')}</div>
                    <Button className="mt-5" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('retry')}</Button>
                </div>
            </div>
        )
    }

    return (
        <div className="onw-story-state-shell relative flex h-[calc(100vh-3.5rem)] min-h-[680px] flex-col overflow-hidden">
            <header className="relative z-20 shrink-0 border-b border-ss-border bg-ss-header px-5 py-4 backdrop-blur-xl">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex min-w-52 items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-ss-accent-border bg-gradient-to-br from-ss-accent/30 to-ss-accent-2/15 shadow-[0_0_28px_color-mix(in_srgb,var(--ss-accent)_25%,transparent)]">
                            <Orbit className="h-5 w-5 text-ss-accent-text" />
                        </div>
                        <div>
                            <h1 className="font-semibold tracking-wide">{t('title')}</h1>
                            <p className="mt-0.5 text-[11px] text-ss-text-muted">{t('subtitle')}</p>
                        </div>
                    </div>

                    <div className="flex rounded-xl border border-ss-border bg-ss-fill p-1">
                        <Button type="button" size="sm" variant="ghost" className={cn('h-8 gap-2 text-ss-text-muted hover:bg-ss-fill-hover hover:text-ss-text', mode === 'graph' && 'bg-ss-accent-soft text-ss-accent-text')} onClick={() => setMode('graph')}>
                            <Network className="h-3.5 w-3.5" />{t('graphMode')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className={cn('h-8 gap-2 text-ss-text-muted hover:bg-ss-fill-hover hover:text-ss-text', mode === 'timeline' && 'bg-ss-accent-soft text-ss-accent-text')} onClick={() => setMode('timeline')}>
                            <Activity className="h-3.5 w-3.5" />{t('timelineMode')}
                        </Button>
                    </div>

                    <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                        <div className="relative w-56">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ss-text-muted" />
                            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} className="h-9 border-ss-border bg-ss-fill pl-9 pr-8 text-ss-text placeholder:text-ss-text-faint focus-visible:border-ss-accent/50 focus-visible:ring-ss-accent/15" />
                            {query && <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ss-text-muted hover:text-ss-text"><X className="h-3.5 w-3.5" /></button>}
                        </div>
                        <Select value={kindFilter} onValueChange={setKindFilter}>
                            <SelectTrigger size="sm" className="h-9 w-40 border-ss-border bg-ss-fill text-ss-text-secondary"><Filter className="h-3.5 w-3.5" /><SelectValue /></SelectTrigger>
                            <SelectContent className="border-ss-border bg-ss-canvas text-ss-text-secondary">
                                <SelectItem value="ALL">{t('allKinds')}</SelectItem>
                                {availableKinds.map((kind) => <SelectItem key={kind} value={kind}>{kind}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Button type="button" variant="ghost" size="icon" className="text-ss-text-muted hover:bg-ss-fill-hover hover:text-ss-text" onClick={() => void load()} disabled={loading} title={t('refresh')}>
                            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                        </Button>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-ss-border bg-ss-fill px-3 py-1.5 text-[11px] text-ss-text-muted"><UsersRound className="h-3.5 w-3.5 text-ss-accent-2" />{t('activeEntities', { count: activeEntityIds.size })}</div>
                    <div className="flex items-center gap-2 rounded-full border border-ss-border bg-ss-fill px-3 py-1.5 text-[11px] text-ss-text-muted"><GitBranch className="h-3.5 w-3.5 text-ss-accent" />{t('activeFacts', { count: activeFacts.length })}</div>
                    <div className="flex items-center gap-2 rounded-full border border-ss-starts-border bg-ss-starts-fill px-3 py-1.5 text-[11px] text-ss-starts-text"><Zap className="h-3.5 w-3.5" />{t('startsCount', { count: startingFacts.length })}</div>
                    <div className="flex items-center gap-2 rounded-full border border-ss-ends-border bg-ss-ends-fill px-3 py-1.5 text-[11px] text-ss-ends-text"><CircleStop className="h-3.5 w-3.5" />{t('endsCount', { count: endingFacts.length })}</div>
                    {resolvedFacts.length > credibleFacts.length && <div className="ml-auto flex items-center gap-1.5 text-[10px] text-ss-text-faint"><Eye className="h-3 w-3" />{t('credibleOnly', { count: resolvedFacts.length - credibleFacts.length })}</div>}
                </div>
            </header>

            {!hasStoryState ? (
                <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center p-8 text-center">
                    <div className="max-w-lg rounded-[2rem] border border-ss-border bg-ss-fill px-10 py-12 shadow-2xl backdrop-blur-xl">
                        <RadioTower className="mx-auto h-11 w-11 text-ss-accent" />
                        <h2 className="mt-5 text-lg font-semibold">{t('emptyTitle')}</h2>
                        <p className="mt-3 text-sm leading-6 text-ss-text-muted">{t('emptyDescription')}</p>
                    </div>
                </div>
            ) : (
                <>
                    <div className="relative z-10 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px]">
                        <div className="relative min-w-0 overflow-hidden border-r border-ss-border">
                            {mode === 'graph' ? (
                                visibleEntities.length > 0 ? (
                                    <StoryStateGraph
                                        entities={visibleEntities}
                                        facts={visibleFacts}
                                        selectedMoment={selectedMoment}
                                        selectedEntityId={selectedEntityId}
                                        selectedFactId={selectedFactId}
                                        onSelectEntity={setSelectedEntityId}
                                        onSelectFact={setSelectedFactId}
                                    />
                                ) : (
                                    <div className="flex h-full items-center justify-center text-sm text-ss-text-muted">{t('noMatches')}</div>
                                )
                            ) : (
                                <StoryStateTimeline
                                    moments={moments}
                                    episodes={episodes}
                                    entities={entities}
                                    facts={visibleFacts}
                                    selectedMomentIndex={selectedMomentIndex}
                                    selectedEntityId={selectedEntityId}
                                    selectedFactId={selectedFactId}
                                    onSelectMoment={selectMomentIndex}
                                    onSelectEntity={setSelectedEntityId}
                                    onSelectFact={setSelectedFactId}
                                />
                            )}
                            <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-ss-border bg-ss-header px-3 py-1.5 text-[10px] text-ss-text-muted shadow-lg backdrop-blur-md">
                                {mode === 'graph' ? t('graphHint') : t('timelineHint')}
                            </div>
                        </div>

                        <aside className="min-h-0 overflow-y-auto bg-ss-sidebar p-4 backdrop-blur-xl onw-editor-scrollbar">
                            {(selectedEntity || selectedFact) && (
                                <section className="mb-5 rounded-2xl border border-ss-accent-2/20 bg-ss-accent-2/[0.06] p-4 shadow-[0_0_28px_color-mix(in_srgb,var(--ss-accent-2)_8%,transparent)]">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-ss-accent-2">
                                            <Sparkles className="h-3.5 w-3.5 shrink-0" />
                                            <span className="truncate">{selectedFact ? t('factDetails') : t('entityDetails')}</span>
                                        </div>
                                        <Button type="button" variant="ghost" size="icon-sm" className="h-6 w-6 text-ss-text-muted hover:bg-ss-fill-hover hover:text-ss-text" onClick={() => { setSelectedEntityId(null); setSelectedFactId(null) }}><X className="h-3.5 w-3.5" /></Button>
                                    </div>

                                    {selectedEntity && !selectedFact && (
                                        <div className="mt-4">
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-base font-semibold">{selectedEntity.name}</h2>
                                                <Badge className="border-ss-accent-border bg-ss-accent-soft text-[9px] text-ss-accent-text">{selectedEntity.kind}</Badge>
                                            </div>
                                            {selectedEntity.summary && <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-ss-text-muted">{selectedEntity.summary}</p>}
                                            {selectedEntity.aliases.length > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-1.5">
                                                    {selectedEntity.aliases.map((alias) => <span key={alias.id} title={alias.sourceKind} className="rounded-full border border-ss-border bg-ss-fill px-2 py-1 text-[10px] text-ss-text-muted">{alias.alias}</span>)}
                                                </div>
                                            )}
                                            <div className="mt-4 border-t border-ss-border pt-3">
                                                <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-ss-text-muted">{t('currentFacts')}</div>
                                                <div className="space-y-2">
                                                    {selectedEntityCurrentFacts.length > 0
                                                        ? selectedEntityCurrentFacts.map((fact) => renderFactLine(fact, factStates.get(fact.id) === 'starts' ? 'starts' : 'active'))
                                                        : <div className="text-xs text-ss-text-faint">{t('noCurrentFacts')}</div>}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {selectedFact && (
                                        <div className="mt-4">
                                            <div className="flex flex-wrap items-center gap-2"><Badge className="border-ss-accent-border bg-ss-accent-soft text-ss-accent-text">{selectedFact.predicateKey}</Badge>{selectedFact.staleCredible && <Badge variant="outline">{t('staleCredible')}</Badge>}{!selectedFact.credible && <Badge variant="destructive">{t('notCredible')}</Badge>}</div>
                                            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ss-text-secondary">{selectedFact.factText}</p>
                                            <div className="mt-3 rounded-xl border border-ss-border bg-ss-fill p-3 text-[11px] text-ss-text-muted">
                                                <div>{entityById.get(selectedFact.subjectEntityId)?.name} <ArrowRight className="mx-1 inline h-3 w-3" /> {selectedFact.objectEntityId ? entityById.get(selectedFact.objectEntityId)?.name : selectedFact.objectValue}</div>
                                                <div className="mt-2 flex items-center gap-1.5 text-ss-text-muted"><Clock3 className="h-3 w-3" />[{moments.find((moment) => moment.id === selectedFact.validFromMomentId)?.label ?? t('storyBeginning')}, {moments.find((moment) => moment.id === selectedFact.validToMomentId)?.label ?? t('stillValid')})</div>
                                            </div>
                                            <div className="mt-4 space-y-2">
                                                <div className="text-[10px] uppercase tracking-[0.14em] text-ss-text-muted">{t('sources')}</div>
                                                {selectedFact.evidence.length > 0 ? selectedFact.evidence.map((evidence) => {
                                                    const episode = episodeById.get(evidence.episodeId)
                                                    if (!episode) return null
                                                    const syncLabel = episodeSyncLabel(episode, t)
                                                    return (
                                                        <button
                                                            type="button"
                                                            key={`${selectedFact.id}-${episode.id}`}
                                                            disabled={!episode.sourceScene}
                                                            onClick={() => episode.sourceScene && onNavigateToScene(episode.sourceScene.chapter.id, episode.sourceScene.id)}
                                                            className="w-full rounded-xl border border-ss-border bg-ss-fill p-3 text-left disabled:cursor-default enabled:hover:bg-ss-fill-hover"
                                                        >
                                                            <div className="flex items-center gap-2 text-[10px]"><span className={evidence.role === 'SUPPORTS' ? 'text-ss-starts' : 'text-ss-ends'}>{evidence.role}</span><span className="text-ss-text-faint">·</span><span className="text-ss-text-muted">{episodeSourceLabel(episode, t('manualSource'), t('sceneSummarySource'))}</span>{syncLabel && <span className="ml-auto text-ss-ends/70">{syncLabel}</span>}</div>
                                                            <p className="mt-1.5 line-clamp-3 text-[11px] leading-5 text-ss-text-muted">{episode.content}</p>
                                                            {episode.sourceScene && <div className="mt-1 text-[10px] text-ss-accent">{episode.sourceScene.chapter.title} · {t('sceneNumber', { number: episode.sourceScene.order + 1 })}</div>}
                                                        </button>
                                                    )
                                                }) : <div className="text-xs text-ss-text-faint">{t('noSources')}</div>}
                                            </div>
                                        </div>
                                    )}
                                </section>
                            )}

                            <section>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ss-text-secondary">{t('momentChanges')}</div>
                                        <div className="mt-1 max-w-64 truncate text-[11px] text-ss-text-faint">{selectedMoment?.label ?? t('globalState')}</div>
                                    </div>
                                    <div className="flex gap-1.5"><Badge className="border-ss-starts-border bg-ss-starts-fill text-ss-starts-text">+{startingFacts.length}</Badge><Badge className="border-ss-ends-border bg-ss-ends-fill text-ss-ends-text">−{endingFacts.length}</Badge></div>
                                </div>

                                <div className="mt-4 space-y-5">
                                    <div>
                                        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-ss-starts"><Zap className="h-3 w-3" />{t('starts')}</div>
                                        <div className="space-y-2">{startingFacts.length > 0 ? startingFacts.map((fact) => renderFactLine(fact, 'starts')) : <div className="rounded-xl border border-dashed border-ss-border px-3 py-5 text-center text-xs text-ss-text-faint">{t('noStarts')}</div>}</div>
                                    </div>
                                    <div>
                                        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-ss-ends"><CircleStop className="h-3 w-3" />{t('ends')}</div>
                                        <div className="space-y-2">{endingFacts.length > 0 ? endingFacts.map((fact) => renderFactLine(fact, 'ends')) : <div className="rounded-xl border border-dashed border-ss-border px-3 py-5 text-center text-xs text-ss-text-faint">{t('noEnds')}</div>}</div>
                                    </div>
                                    {momentEpisodes.length > 0 && (
                                        <div>
                                            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-ss-episodes"><BookOpenText className="h-3 w-3" />{t('episodesAtMoment')}</div>
                                            <div className="space-y-2">{momentEpisodes.map((episode) => {
                                                const syncLabel = episodeSyncLabel(episode, t)
                                                return (
                                                    <button key={episode.id} type="button" disabled={!episode.sourceScene} onClick={() => episode.sourceScene && onNavigateToScene(episode.sourceScene.chapter.id, episode.sourceScene.id)} className="w-full rounded-xl border border-ss-episodes/20 bg-ss-episodes-fill p-3 text-left disabled:cursor-default enabled:hover:bg-ss-fill-hover">
                                                        <div className="flex items-center gap-2 text-[10px] text-ss-episodes-text"><span>{episodeSourceLabel(episode, t('manualSource'), t('sceneSummarySource'))}</span>{syncLabel && <span className="ml-auto text-ss-ends/70">{syncLabel}</span>}</div>
                                                        <p className="mt-1.5 line-clamp-3 text-[11px] leading-5 text-ss-text-muted">{episode.content}</p>
                                                    </button>
                                                )
                                            })}</div>
                                        </div>
                                    )}
                                </div>
                            </section>
                        </aside>
                    </div>

                    <div className="relative z-20 shrink-0 border-t border-ss-border bg-ss-header px-5 py-3 backdrop-blur-xl">
                        <div className="flex items-center gap-4">
                            <div className="flex shrink-0 items-center gap-1">
                                <Button type="button" variant="ghost" size="icon-sm" className="text-ss-text-muted hover:bg-ss-fill-hover hover:text-ss-text" disabled={moments.length === 0 || selectedMomentIndex <= 0} onClick={() => selectMomentIndex(selectedMomentIndex - 1)} title={t('previousMoment')}><ChevronLeft className="h-4 w-4" /></Button>
                                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full border border-ss-accent-border bg-ss-accent-soft text-ss-accent-text hover:bg-ss-fill-hover" disabled={moments.length < 2} onClick={() => {
                                    if (selectedMomentIndex >= moments.length - 1) setSelectedMomentIndex(0)
                                    setPlaying((current) => !current)
                                }} title={playing ? t('pause') : t('play')}>
                                    {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                                </Button>
                                <Button type="button" variant="ghost" size="icon-sm" className="text-ss-text-muted hover:bg-ss-fill-hover hover:text-ss-text" disabled={moments.length === 0 || selectedMomentIndex >= moments.length - 1} onClick={() => selectMomentIndex(selectedMomentIndex + 1)} title={t('nextMoment')}><ChevronRight className="h-4 w-4" /></Button>
                            </div>

                            <div className="min-w-0 flex-1">
                                <div className="relative h-7">
                                    {moments.map((moment, index) => {
                                        const starts = credibleFacts.filter((fact) => fact.validFromMomentId === moment.id).length
                                        const ends = credibleFacts.filter((fact) => fact.validToMomentId === moment.id).length
                                        const hasChanges = starts > 0 || ends > 0
                                        return <button
                                            key={moment.id}
                                            type="button"
                                            onClick={() => selectMomentIndex(index)}
                                            className="absolute top-1/2 z-20 flex h-[17px] w-[17px] -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                                            style={{ left: `${moments.length <= 1 ? 0 : index / (moments.length - 1) * 100}%` }}
                                            title={`${moment.label}: +${starts} / -${ends}`}
                                            aria-label={`${moment.label}: +${starts} / -${ends}`}
                                        >
                                            {index === selectedMomentIndex && <span className="onw-story-state-moment-thumb pointer-events-none absolute inset-0" />}
                                            <span className={cn('relative rounded-full bg-ss-text-faint', hasChanges ? 'h-2 w-2 bg-ss-accent shadow-[0_0_8px_color-mix(in_srgb,var(--ss-accent)_65%,transparent)]' : 'h-1.5 w-1.5')} />
                                        </button>
                                    })}
                                    <input
                                        type="range"
                                        min={0}
                                        max={Math.max(0, moments.length - 1)}
                                        step={1}
                                        value={selectedMomentIndex}
                                        disabled={moments.length < 2}
                                        onChange={(event) => selectMomentIndex(Number(event.target.value))}
                                        className="onw-story-state-range absolute inset-0 z-10 w-full"
                                        aria-label={t('storyTimeline')}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-3 text-[10px] text-ss-text-faint"><span className="max-w-48 truncate">{moments[0]?.label ?? t('globalState')}</span><span className="max-w-48 truncate text-right">{moments.at(-1)?.label ?? ''}</span></div>
                            </div>

                            <div className="w-64 shrink-0 text-right">
                                <div className="truncate text-sm font-semibold text-ss-text">{selectedMoment?.label ?? t('globalState')}</div>
                                <div className="mt-1 font-mono text-[10px] text-ss-text-faint">{selectedMoment ? `storyOrder: ${selectedMoment.storyOrder}` : t('noStoryOrder')}</div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
