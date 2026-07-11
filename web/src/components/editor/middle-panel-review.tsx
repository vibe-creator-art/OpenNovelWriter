'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    Background,
    BackgroundVariant,
    Controls,
    Handle,
    MarkerType,
    MiniMap,
    Position,
    ReactFlow,
    useEdgesState,
    useNodesState,
    type Edge,
    type Node,
    type NodeProps,
} from '@xyflow/react'
import { BookText, CalendarDays, ChevronDown, LayoutGrid, MapPin, Network, Shapes, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CroppedImage } from '@/components/image/cropped-image'
import { parseImageCrop } from '@/lib/image-crop'
import { htmlToText } from '@/lib/html-to-text'
import { novelReviewApi, type ChapterWithScenes, type NovelReviewData } from '@/lib/api'
import { cn } from '@/lib/utils'
import { dispatchOpenTermEntry } from '@/components/editor/terms/term-entry-events'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import {
    buildTermMentionMatcher,
    findMentionsInText,
    toMentionPhraseKey,
} from '@/components/editor/terms/term-mentions-utils'
import type { TermEntry } from '@/components/editor/terms/types'

type TimelineScene = {
    id: string
    chapterId: string
    chapterTitle: string
    chapterIndex: number
    sceneNumber: number
    isChapterStart: boolean
    text: string
}

type MentionMatrix = {
    totalByTermId: Map<string, number>
    sceneCountsByTermId: Map<string, number[]>
}

type TermNodeData = {
    entry: TermEntry
    size: number
    selected: boolean
    dimmed: boolean
}

type TermGraphNode = Node<TermNodeData, 'term'>

function formatSigned(value: number) {
    if (value > 0) return `+${value.toLocaleString()}`
    return value.toLocaleString()
}

function termFallbackIcon(entry: TermEntry) {
    if (entry.categoryId === 'characters') return <UserRound className="h-5 w-5" />
    if (entry.categoryId === 'locations') return <MapPin className="h-5 w-5" />
    if (entry.categoryId === 'items') return <Shapes className="h-5 w-5" />
    return <BookText className="h-5 w-5" />
}

function TermGraphNodeView({ data }: NodeProps<TermGraphNode>) {
    const { entry, size, selected, dimmed } = data
    return (
        <div
            className={cn(
                'relative flex flex-col items-center transition-all duration-300',
                dimmed && 'opacity-20 grayscale',
                selected && 'scale-110'
            )}
            style={{ width: size + 34 }}
        >
            <Handle type="target" position={Position.Left} className="!h-1 !w-1 !border-0 !bg-transparent" />
            <div
                className={cn(
                    'overflow-hidden rounded-full border-2 bg-card shadow-lg transition-all duration-300',
                    selected ? 'border-orange-400 shadow-[0_0_30px_rgba(251,146,60,0.48)]' : 'border-border'
                )}
                style={{ width: size, height: size }}
            >
                {entry.avatar ? (
                    <CroppedImage
                        src={entry.avatar}
                        crop={parseImageCrop(entry.avatarCrop)}
                        aspectRatio={1}
                        className="h-full w-full"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-100 to-amber-50 text-orange-700 dark:from-orange-950 dark:to-amber-950 dark:text-orange-200">
                        {termFallbackIcon(entry)}
                    </div>
                )}
            </div>
            <div className={cn('mt-2 max-w-full truncate rounded-full border bg-background/90 px-2.5 py-1 text-xs font-medium shadow-sm', selected && 'border-orange-300 text-orange-700 dark:text-orange-200')}>
                {entry.title}
            </div>
            <Handle type="source" position={Position.Right} className="!h-1 !w-1 !border-0 !bg-transparent" />
        </div>
    )
}

const nodeTypes = { term: TermGraphNodeView }

function buildGraphLayout(entries: TermEntry[], mentionTotals: Map<string, number>) {
    const activeById = new Map(entries.filter((entry) => !entry.archived).map((entry) => [entry.id, entry] as const))
    const relationEntries = entries.filter((entry) =>
        !entry.archived && (entry.relations ?? []).some((relation) => activeById.has(relation.otherId))
    )
    const maxMention = Math.max(1, ...relationEntries.map((entry) => mentionTotals.get(entry.id) ?? 0))
    const radius = Math.max(230, Math.min(520, relationEntries.length * 34))
    const center = radius + 150

    const nodes: TermGraphNode[] = relationEntries.map((entry, index) => {
        const angle = (index / Math.max(1, relationEntries.length)) * Math.PI * 2 - Math.PI / 2
        const count = mentionTotals.get(entry.id) ?? 0
        const normalized = Math.log1p(count) / Math.log1p(maxMention)
        const size = Math.round(46 + normalized * 48)
        return {
            id: entry.id,
            type: 'term',
            position: { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius },
            data: { entry, size, selected: false, dimmed: false },
        }
    })

    const seen = new Set<string>()
    const edges: Edge[] = []
    for (const entry of relationEntries) {
        for (const relation of entry.relations ?? []) {
            if (!activeById.has(relation.otherId) || seen.has(relation.id)) continue
            seen.add(relation.id)
            const source = relation.direction === 'incoming' ? relation.otherId : entry.id
            const target = relation.direction === 'incoming' ? entry.id : relation.otherId
            edges.push({
                id: relation.id,
                source,
                target,
                label: relation.label?.trim() || undefined,
                markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
                markerStart: relation.direction === 'bidirectional'
                    ? { type: MarkerType.ArrowClosed, width: 16, height: 16 }
                    : undefined,
                style: { strokeWidth: 1.7 },
                labelStyle: { fontSize: 11, fontWeight: 600 },
                labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.9 },
                labelBgPadding: [5, 3],
                labelBgBorderRadius: 8,
            })
        }
    }
    return { nodes, edges }
}

function RelationshipGraph({ entries, mentionTotals, novelId }: { entries: TermEntry[]; mentionTotals: Map<string, number>; novelId: string }) {
    const t = useTranslations('editor.reviewDashboard')
    const layout = useMemo(() => buildGraphLayout(entries, mentionTotals), [entries, mentionTotals])
    const [nodes, setNodes, onNodesChange] = useNodesState<TermGraphNode>(layout.nodes)
    const [edges, , onEdgesChange] = useEdgesState(layout.edges)
    const [selectedId, setSelectedId] = useState<string | null>(null)

    const connectedIds = useMemo(() => {
        if (!selectedId) return new Set<string>()
        const ids = new Set<string>([selectedId])
        for (const edge of edges) {
            if (edge.source === selectedId) ids.add(edge.target)
            if (edge.target === selectedId) ids.add(edge.source)
        }
        return ids
    }, [edges, selectedId])

    const displayedNodes = useMemo(() => nodes.map((node) => ({
        ...node,
        data: {
            ...node.data,
            selected: node.id === selectedId,
            dimmed: Boolean(selectedId && !connectedIds.has(node.id)),
        },
    })), [connectedIds, nodes, selectedId])

    const displayedEdges = useMemo(() => edges.map((edge) => {
        const connected = !selectedId || edge.source === selectedId || edge.target === selectedId
        return {
            ...edge,
            animated: Boolean(selectedId && connected),
            style: {
                ...edge.style,
                stroke: selectedId && connected ? '#f97316' : undefined,
                opacity: connected ? 1 : 0.12,
                strokeWidth: selectedId && connected ? 2.8 : 1.7,
            },
        }
    }), [edges, selectedId])

    const resetLayout = useCallback(() => {
        setNodes(layout.nodes)
        setSelectedId(null)
    }, [layout.nodes, setNodes])

    if (layout.nodes.length === 0) {
        return <div className="flex h-[430px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">{t('relationshipEmpty')}</div>
    }

    return (
        <div className="relative h-[560px] overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_center,rgba(251,146,60,0.08),transparent_55%)]">
            <Button variant="outline" size="sm" className="absolute right-3 top-3 z-10 gap-1.5 bg-background/90" onClick={resetLayout}>
                <LayoutGrid className="h-3.5 w-3.5" /> {t('resetLayout')}
            </Button>
            <ReactFlow
                nodes={displayedNodes}
                edges={displayedEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => {
                    setSelectedId(node.id)
                    dispatchOpenTermEntry({ novelId, entryId: node.id, tab: 'details' })
                }}
                onPaneClick={() => setSelectedId(null)}
                fitView
                fitViewOptions={{ padding: 0.22 }}
                minZoom={0.25}
                maxZoom={2.2}
            >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable className="!bg-background/80" nodeColor={(node) => node.id === selectedId ? '#f97316' : '#a8a29e'} />
            </ReactFlow>
        </div>
    )
}

export function MiddlePanelReview({
    novelId,
    chapters,
    onNavigateToScene,
}: {
    novelId: string
    chapters: ChapterWithScenes[]
    onNavigateToScene: (chapterId: string, sceneId: string) => void
}) {
    const t = useTranslations('editor.reviewDashboard')
    const entries = useStoredTermEntries(novelId)
    const [reviewData, setReviewData] = useState<NovelReviewData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [dayRange, setDayRange] = useState<30 | 90 | 'all'>(30)
    const [selectedTermIdsOverride, setSelectedTermIdsOverride] = useState<string[] | null>(null)
    const storageKey = `review_heatmap_terms_${novelId}`

    useEffect(() => {
        let canceled = false
        novelReviewApi.get(novelId)
            .then((data) => {
                if (!canceled) setReviewData(data)
            })
            .catch((reason) => {
                if (!canceled) setError(reason instanceof Error ? reason.message : t('loadError'))
            })
            .finally(() => {
                if (!canceled) setLoading(false)
            })
        return () => { canceled = true }
    }, [novelId, t])

    const timeline = useMemo<TimelineScene[]>(() => {
        const sorted = chapters.slice().sort((a, b) => a.actNumber - b.actNumber || a.order - b.order)
        return sorted.flatMap((chapter, chapterIndex) =>
            chapter.scenes.slice().sort((a, b) => a.order - b.order).map((scene, sceneIndex) => ({
                id: scene.id,
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                chapterIndex: chapterIndex + 1,
                sceneNumber: sceneIndex + 1,
                isChapterStart: sceneIndex === 0,
                text: htmlToText(scene.content),
            }))
        )
    }, [chapters])

    const activeEntries = useMemo(() => entries.filter((entry) => !entry.archived && entry.title.trim()), [entries])
    const mentionMatrix = useMemo<MentionMatrix>(() => {
        const totalByTermId = new Map<string, number>()
        const sceneCountsByTermId = new Map<string, number[]>()
        for (const entry of activeEntries) sceneCountsByTermId.set(entry.id, new Array(timeline.length).fill(0))
        const matcher = buildTermMentionMatcher(activeEntries)
        if (!matcher.regex) return { totalByTermId, sceneCountsByTermId }

        timeline.forEach((scene, sceneIndex) => {
            const matches = findMentionsInText(scene.text, new RegExp(matcher.regex!.source, matcher.regex!.flags))
            for (const match of matches) {
                const token = matcher.tokenByPhraseKey.get(toMentionPhraseKey(match.text))
                if (!token) continue
                totalByTermId.set(token.termId, (totalByTermId.get(token.termId) ?? 0) + 1)
                const counts = sceneCountsByTermId.get(token.termId)
                if (counts) counts[sceneIndex] += 1
            }
        })
        return { totalByTermId, sceneCountsByTermId }
    }, [activeEntries, timeline])

    const defaultSelectedTermIds = useMemo(() => {
        if (activeEntries.length === 0) return []
        const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(storageKey)
        if (stored) {
            try {
                const parsed = JSON.parse(stored)
                if (Array.isArray(parsed)) {
                    const valid = parsed.filter((id): id is string => typeof id === 'string' && activeEntries.some((entry) => entry.id === id))
                    if (valid.length > 0) return valid
                }
            } catch {}
        }
        return activeEntries.slice().sort((a, b) =>
            (mentionMatrix.totalByTermId.get(b.id) ?? 0) - (mentionMatrix.totalByTermId.get(a.id) ?? 0)
            || a.title.localeCompare(b.title)
        ).slice(0, 10).map((entry) => entry.id)
    }, [activeEntries, mentionMatrix.totalByTermId, storageKey])

    const selectedTermIds = selectedTermIdsOverride ?? defaultSelectedTermIds

    useEffect(() => {
        if (selectedTermIdsOverride === null) return
        window.localStorage.setItem(storageKey, JSON.stringify(selectedTermIdsOverride))
    }, [selectedTermIdsOverride, storageKey])

    const selectedEntries = useMemo(() => selectedTermIds
        .map((id) => activeEntries.find((entry) => entry.id === id) ?? null)
        .filter((entry): entry is TermEntry => entry !== null), [activeEntries, selectedTermIds])
    const visibleDays = useMemo(() => dayRange === 'all' ? reviewData?.days ?? [] : (reviewData?.days ?? []).slice(0, dayRange), [dayRange, reviewData?.days])

    if (loading) return <div className="flex min-h-[500px] items-center justify-center text-sm text-muted-foreground">{t('loading')}</div>
    if (error || !reviewData) return <div className="flex min-h-[500px] items-center justify-center text-sm text-destructive">{error || t('loadError')}</div>

    return (
        <div className="min-h-full bg-muted/20 px-5 py-6 sm:px-8 lg:px-10">
            <div className="mx-auto max-w-[1500px] space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Card className="gap-3 overflow-hidden border-orange-200/70 bg-gradient-to-br from-background via-background to-orange-50/80 py-5 dark:border-orange-900/50 dark:to-orange-950/25">
                        <CardHeader className="px-5">
                            <CardDescription className="flex items-center gap-2 font-semibold uppercase tracking-[0.16em]"><BookText className="h-4 w-4 text-orange-500" />{t('totalWordCount')}</CardDescription>
                            <CardTitle className="text-4xl tabular-nums sm:text-5xl">{reviewData.totalWordCount.toLocaleString()}</CardTitle>
                        </CardHeader>
                    </Card>
                    <Card className="gap-3 overflow-hidden border-emerald-200/70 bg-gradient-to-br from-background via-background to-emerald-50/80 py-5 dark:border-emerald-900/50 dark:to-emerald-950/25">
                        <CardHeader className="px-5">
                            <CardDescription className="flex items-center gap-2 font-semibold uppercase tracking-[0.16em]"><CalendarDays className="h-4 w-4 text-emerald-500" />{t('today')}</CardDescription>
                            <CardTitle className={cn('text-4xl tabular-nums sm:text-5xl', reviewData.todayWordCount < 0 ? 'text-rose-600' : 'text-emerald-600')}>{formatSigned(reviewData.todayWordCount)}</CardTitle>
                        </CardHeader>
                    </Card>
                </div>

                <Card className="gap-4 py-5">
                    <CardHeader className="gap-1 px-5 sm:flex sm:flex-row sm:items-start sm:justify-between">
                        <CardTitle>{t('dailyTitle')}</CardTitle>
                        <div className="mt-3 flex rounded-lg border p-0.5 sm:mt-0">
                            {([30, 90, 'all'] as const).map((range) => <Button key={range} size="sm" variant={dayRange === range ? 'secondary' : 'ghost'} className="h-7 px-2.5" onClick={() => setDayRange(range)}>{range === 'all' ? t('all') : t('days', { count: range })}</Button>)}
                        </div>
                    </CardHeader>
                    <CardContent className="px-5">
                        {visibleDays.length === 0 ? <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">{t('dailyEmpty')}</div> : (
                            <div className="overflow-hidden rounded-xl border">
                                <div className="grid grid-cols-[1fr_1fr_1fr] bg-muted/60 px-4 py-2.5 text-xs font-semibold text-muted-foreground"><span>{t('date')}</span><span className="text-right">{t('dailyChange')}</span><span className="text-right">{t('endingTotal')}</span></div>
                                {visibleDays.map((day) => <div key={day.dateKey} className="grid grid-cols-[1fr_1fr_1fr] border-t px-4 py-3 text-sm"><span>{day.dateKey}</span><span className={cn('text-right font-medium tabular-nums', day.netWordCount > 0 ? 'text-emerald-600' : day.netWordCount < 0 ? 'text-rose-600' : 'text-muted-foreground')}>{formatSigned(day.netWordCount)}</span><span className="text-right tabular-nums">{day.endingWordCount.toLocaleString()}</span></div>)}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="gap-4 py-5">
                    <CardHeader className="gap-1 px-5 sm:flex sm:flex-row sm:items-start sm:justify-between">
                        <CardTitle>{t('heatmapTitle')}</CardTitle>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="mt-3 gap-2 sm:mt-0">{t('displayTerms', { count: selectedTermIds.length })}<ChevronDown className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="max-h-[420px] w-72 overflow-y-auto">
                                <DropdownMenuLabel>{t('chooseTerms')}</DropdownMenuLabel><DropdownMenuSeparator />
                                {activeEntries.map((entry) => <DropdownMenuCheckboxItem key={entry.id} checked={selectedTermIds.includes(entry.id)} onCheckedChange={(checked) => setSelectedTermIdsOverride((current) => { const base = current ?? selectedTermIds; return checked ? [...base, entry.id] : base.filter((id) => id !== entry.id) })}><span className="min-w-0 flex-1 truncate">{entry.title}</span><span className="ml-2 text-xs tabular-nums text-muted-foreground">{mentionMatrix.totalByTermId.get(entry.id) ?? 0}</span></DropdownMenuCheckboxItem>)}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </CardHeader>
                    <CardContent className="px-5">
                        {selectedEntries.length === 0 || timeline.length === 0 ? <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">{t('heatmapEmpty')}</div> : (
                            <div className="onw-editor-scrollbar overflow-x-auto rounded-xl border">
                                <div style={{ minWidth: 230 + timeline.length * 13 }}>
                                    <div className="flex h-11 border-b bg-muted/40">
                                        <div className="sticky left-0 z-20 flex w-[230px] shrink-0 items-center border-r bg-muted/95 px-3 text-xs font-semibold text-muted-foreground">{t('term')}</div>
                                        {timeline.map((scene) => <div key={scene.id} title={`${t('chapter')} ${scene.chapterIndex}: ${scene.chapterTitle} · ${t('scene')} ${scene.sceneNumber}`} className={cn('h-full w-[13px] shrink-0', scene.isChapterStart && 'border-l border-slate-300/70 dark:border-slate-700/70')} />)}
                                    </div>
                                    {selectedEntries.map((entry) => {
                                        const counts = mentionMatrix.sceneCountsByTermId.get(entry.id) ?? []
                                        return <div key={entry.id} className="flex h-10 border-b last:border-b-0">
                                            <button type="button" onClick={() => dispatchOpenTermEntry({ novelId, entryId: entry.id, tab: 'details' })} className="sticky left-0 z-10 flex w-[230px] shrink-0 items-center gap-2.5 border-r bg-background/95 px-3 text-left hover:bg-muted">
                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
                                                    {entry.avatar ? <CroppedImage src={entry.avatar} crop={parseImageCrop(entry.avatarCrop)} aspectRatio={1} className="h-full w-full" /> : termFallbackIcon(entry)}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.title}</span>
                                                <span className="text-xs tabular-nums text-muted-foreground">{mentionMatrix.totalByTermId.get(entry.id) ?? 0}</span>
                                            </button>
                                            {timeline.map((scene, index) => {
                                                const count = counts[index] ?? 0
                                                const alpha = count === 0 ? 0 : Math.min(0.92, 0.22 + Math.log2(count + 1) * 0.2)
                                                return <button
                                                    type="button"
                                                    onClick={() => onNavigateToScene(scene.chapterId, scene.id)}
                                                    key={scene.id}
                                                    title={`${entry.title} · ${scene.chapterTitle} · ${t('scene')} ${scene.sceneNumber}: ${count}`}
                                                    className={cn('my-[3px] h-[34px] w-[13px] shrink-0 transition-transform hover:z-10 hover:scale-y-110', scene.isChapterStart && 'border-l border-slate-300/70 dark:border-slate-700/70')}
                                                    style={{
                                                        backgroundColor: count ? `rgba(249, 115, 22, ${alpha})` : 'rgba(120,120,120,0.055)',
                                                        borderRight: '0.5px solid color-mix(in srgb, var(--background) 72%, transparent)',
                                                    }}
                                                />
                                            })}
                                        </div>
                                    })}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="gap-4 py-5">
                    <CardHeader className="px-5"><CardTitle className="flex items-center gap-2"><Network className="h-5 w-5 text-orange-500" />{t('relationshipTitle')}</CardTitle></CardHeader>
                    <CardContent className="px-5"><RelationshipGraph key={`${timeline.length}:${activeEntries.map((entry) => `${entry.id}:${entry.relations?.length ?? 0}:${mentionMatrix.totalByTermId.get(entry.id) ?? 0}`).join('|')}`} entries={activeEntries} mentionTotals={mentionMatrix.totalByTermId} novelId={novelId} /></CardContent>
                </Card>
            </div>
        </div>
    )
}
