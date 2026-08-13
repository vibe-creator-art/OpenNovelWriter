'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Diamond, FilterX, Radio } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
    StoryStateVisualizationEntity,
    StoryStateVisualizationEpisode,
    StoryStateVisualizationMoment,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import {
    storyFactTouchesEntity,
    type ResolvedStoryFact,
} from '@/components/editor/story-state-visualization-utils'

const LABEL_WIDTH = 270

function positionPercent(index: number, count: number) {
    if (count <= 1) return index === 0 ? 0 : 100
    return index / (count - 1) * 100
}

export function StoryStateTimeline({
    moments,
    episodes,
    entities,
    facts,
    selectedMomentIndex,
    selectedEntityId,
    selectedFactId,
    onSelectMoment,
    onSelectEntity,
    onSelectFact,
}: {
    moments: StoryStateVisualizationMoment[]
    episodes: StoryStateVisualizationEpisode[]
    entities: StoryStateVisualizationEntity[]
    facts: ResolvedStoryFact[]
    selectedMomentIndex: number
    selectedEntityId: string | null
    selectedFactId: string | null
    onSelectMoment: (index: number) => void
    onSelectEntity: (entityId: string | null) => void
    onSelectFact: (factId: string | null) => void
}) {
    const t = useTranslations('editor.storyStateDashboard')
    const entityById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity] as const)), [entities])
    const momentIndexById = useMemo(() => new Map(moments.map((moment, index) => [moment.id, index] as const)), [moments])
    const scopedFacts = useMemo(() => facts.filter((fact) => fact.credible
        && (!selectedEntityId || storyFactTouchesEntity(fact, selectedEntityId))), [facts, selectedEntityId])
    const trackWidth = Math.max(760, moments.length * 118)
    const selectedPercent = positionPercent(selectedMomentIndex, moments.length)

    if (moments.length === 0) {
        return (
            <div className="flex h-full items-center justify-center px-8 text-center">
                <div className="max-w-md rounded-3xl border border-ss-border bg-ss-surface px-8 py-10 shadow-2xl backdrop-blur-xl">
                    <Radio className="mx-auto h-9 w-9 text-ss-accent" />
                    <div className="mt-4 font-semibold text-ss-text">{t('timelineNoMomentsTitle')}</div>
                    <p className="mt-2 text-sm leading-6 text-ss-text-muted">{t('timelineNoMomentsDescription')}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="h-full overflow-auto onw-editor-scrollbar">
            <div style={{ minWidth: LABEL_WIDTH + trackWidth }}>
                <div className="sticky top-0 z-30 flex h-[92px] border-b border-ss-border bg-ss-sticky backdrop-blur-xl">
                    <div
                        className="sticky left-0 z-40 flex shrink-0 items-center border-r border-ss-border bg-ss-sticky px-5"
                        style={{ width: LABEL_WIDTH }}
                    >
                        <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ss-accent-text">{t('lifelines')}</div>
                            {selectedEntityId ? (
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="truncate text-sm text-ss-text-secondary">{entityById.get(selectedEntityId)?.name}</span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className="h-6 w-6 text-ss-text-muted hover:bg-ss-fill-hover hover:text-ss-text"
                                        onClick={() => onSelectEntity(null)}
                                        title={t('clearEntityFilter')}
                                    >
                                        <FilterX className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            ) : <div className="mt-2 text-sm text-ss-text-muted">{t('allFacts')}</div>}
                        </div>
                    </div>
                    <div className="relative shrink-0" style={{ width: trackWidth }}>
                        <div
                            className="onw-ss-playhead absolute bottom-0 top-0 z-10 w-px"
                            style={{ left: `${selectedPercent}%` }}
                        />
                        {moments.map((moment, index) => {
                            const momentEpisodes = episodes.filter((episode) => episode.referenceMomentId === moment.id)
                            return (
                                <button
                                    key={moment.id}
                                    type="button"
                                    onClick={() => onSelectMoment(index)}
                                    className={cn(
                                        'absolute bottom-0 top-0 z-20 w-[108px] -translate-x-1/2 px-2 text-center text-[10px] text-ss-text-muted transition-colors hover:text-ss-text-secondary',
                                        index === 0 && 'translate-x-0 text-left',
                                        index === moments.length - 1 && '-translate-x-full text-right',
                                        selectedMomentIndex === index && 'text-ss-accent-2'
                                    )}
                                    style={{ left: `${positionPercent(index, moments.length)}%` }}
                                    title={`${moment.label} · storyOrder ${moment.storyOrder}`}
                                >
                                    <span className="onw-ss-moment-dot absolute bottom-3 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2" />
                                    <span className="absolute bottom-8 left-1/2 max-w-[104px] -translate-x-1/2 truncate font-medium">{moment.label}</span>
                                    {momentEpisodes.length > 0 && (
                                        <span className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 text-ss-episodes">
                                            <Diamond className="h-3 w-3 fill-ss-episodes/30" />
                                            {momentEpisodes.length}
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </div>

                {scopedFacts.length === 0 ? (
                    <div className="flex h-64 items-center justify-center text-sm text-ss-text-muted">{t('timelineEmpty')}</div>
                ) : scopedFacts.map((fact) => {
                    const subject = entityById.get(fact.subjectEntityId)
                    const object = fact.objectEntityId ? entityById.get(fact.objectEntityId) : null
                    const fromIndex = fact.validFromMomentId ? momentIndexById.get(fact.validFromMomentId) ?? 0 : 0
                    const toIndex = fact.validToMomentId ? momentIndexById.get(fact.validToMomentId) ?? moments.length - 1 : moments.length
                    const left = positionPercent(fromIndex, moments.length)
                    const right = fact.validToMomentId ? positionPercent(toIndex, moments.length) : 100
                    const width = Math.max(1.1, right - left)
                    const selected = selectedFactId === fact.id
                    return (
                        <div key={fact.id} className={cn('group flex min-h-[66px] border-b border-ss-border transition-colors hover:bg-ss-fill', selected && 'bg-ss-row-selected')}>
                            <button
                                type="button"
                                className="sticky left-0 z-20 flex shrink-0 items-center border-r border-ss-border bg-ss-sticky px-5 text-left backdrop-blur-xl transition-colors hover:bg-ss-fill-hover"
                                style={{ width: LABEL_WIDTH }}
                                onClick={() => {
                                    onSelectEntity(fact.subjectEntityId)
                                    onSelectFact(null)
                                }}
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-xs font-semibold text-ss-text-secondary">{subject?.name ?? fact.subjectEntityId}</span>
                                        <Badge className="h-5 max-w-28 truncate border-ss-accent-border bg-ss-accent-soft px-1.5 text-[9px] text-ss-accent-text">{fact.predicateKey}</Badge>
                                    </div>
                                    <div className="mt-1 truncate text-[10px] text-ss-text-muted">→ {object?.name ?? fact.objectValue}</div>
                                </div>
                            </button>
                            <div className="relative shrink-0" style={{ width: trackWidth }}>
                                <div
                                    className="onw-ss-playhead absolute bottom-0 top-0 z-0 w-px opacity-60"
                                    style={{ left: `${selectedPercent}%` }}
                                />
                                {moments.map((moment, index) => (
                                    <div
                                        key={moment.id}
                                        className="absolute bottom-0 top-0 w-px bg-[var(--ss-grid-line)]"
                                        style={{ left: `${positionPercent(index, moments.length)}%` }}
                                    />
                                ))}
                                <button
                                    type="button"
                                    onClick={() => onSelectFact(fact.id)}
                                    className={cn(
                                        'onw-ss-lifeline absolute top-1/2 z-10 h-5 -translate-y-1/2 rounded-full border transition-[filter,transform,box-shadow] hover:brightness-125',
                                        fact.validFromMomentId && 'rounded-l-sm',
                                        fact.validToMomentId && 'rounded-r-sm',
                                        selected && 'is-selected h-6 -translate-y-1/2 ring-1 ring-ss-accent-2'
                                    )}
                                    style={{ left: `${left}%`, width: `${width}%` }}
                                    title={fact.factText}
                                >
                                    {fact.validFromMomentId && <span className="absolute -left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border border-ss-starts-text/70 bg-ss-starts" />}
                                    {fact.validToMomentId && <span className="absolute -right-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border border-ss-ends-text/70 bg-ss-ends" />}
                                </button>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
