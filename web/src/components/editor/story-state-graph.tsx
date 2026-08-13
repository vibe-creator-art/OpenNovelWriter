'use client'

import { useMemo } from 'react'
import {
    Background,
    BackgroundVariant,
    BaseEdge,
    Controls,
    EdgeLabelRenderer,
    Handle,
    MarkerType,
    MiniMap,
    Position,
    ReactFlow,
    getBezierPath,
    type Edge,
    type EdgeProps,
    type Node,
    type NodeProps,
} from '@xyflow/react'
import {
    forceCenter,
    forceCollide,
    forceLink,
    forceManyBody,
    forceSimulation,
    type SimulationLinkDatum,
    type SimulationNodeDatum,
} from 'd3-force'
import {
    BookOpenText,
    Box,
    Building2,
    CalendarClock,
    CircleDot,
    Lightbulb,
    MapPin,
    UserRound,
} from 'lucide-react'

import type {
    StoryStateVisualizationEntity,
    StoryStateVisualizationMoment,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppThemeStore } from '@/lib/app-theme-store'
import {
    firstActiveMomentOrderForEntity,
    getStoryFactMomentState,
    storyFactTouchesEntity,
    type ResolvedStoryFact,
    type StoryFactMomentState,
} from '@/components/editor/story-state-visualization-utils'

type EntityVisualState = 'active' | 'new' | 'ending' | 'dormant'

type StoryEntityNodeData = {
    entity: StoryStateVisualizationEntity
    literalFacts: Array<{ fact: ResolvedStoryFact; state: StoryFactMomentState }>
    visualState: EntityVisualState
    selected: boolean
}

type StoryEntityNode = Node<StoryEntityNodeData, 'storyEntity'>

type StoryFactEdgeData = {
    fact: ResolvedStoryFact
    state: Exclude<StoryFactMomentState, 'inactive'>
    selected: boolean
}

type StoryFactEdge = Edge<StoryFactEdgeData, 'storyFact'>

type LayoutNode = SimulationNodeDatum & { id: string }
type LayoutLink = SimulationLinkDatum<LayoutNode> & {
    source: string | LayoutNode
    target: string | LayoutNode
}

const NODE_WIDTH = 210

function storyEntityNodeHeight(literalFactCount: number) {
    const visibleCount = Math.min(3, literalFactCount)
    if (visibleCount === 0) return 60
    const factsHeight = visibleCount * 23 + Math.max(0, visibleCount - 1) * 6
    return 60 + 12 + factsHeight + (literalFactCount > visibleCount ? 17 : 0)
}

function entityKindIcon(kind: string) {
    const className = 'h-4 w-4'
    switch (kind) {
        case 'CHARACTER': return <UserRound className={className} />
        case 'LOCATION': return <MapPin className={className} />
        case 'ITEM': return <Box className={className} />
        case 'ORGANIZATION': return <Building2 className={className} />
        case 'EVENT': return <CalendarClock className={className} />
        case 'INFORMATION': return <BookOpenText className={className} />
        case 'CONCEPT': return <Lightbulb className={className} />
        default: return <CircleDot className={className} />
    }
}

function kindAccent(kind: string) {
    switch (kind) {
        case 'CHARACTER': return 'from-cyan-400 to-blue-500'
        case 'LOCATION': return 'from-emerald-400 to-teal-500'
        case 'ITEM': return 'from-amber-400 to-orange-500'
        case 'ORGANIZATION': return 'from-violet-400 to-purple-500'
        case 'EVENT': return 'from-rose-400 to-pink-500'
        case 'INFORMATION': return 'from-sky-400 to-indigo-500'
        case 'CONCEPT': return 'from-fuchsia-400 to-violet-500'
        default: return 'from-slate-400 to-slate-500'
    }
}

function factStroke(state: Exclude<StoryFactMomentState, 'inactive'>) {
    if (state === 'starts') return 'var(--ss-fact-starts)'
    if (state === 'ends') return 'var(--ss-fact-ends)'
    return 'var(--ss-fact-active)'
}

function readThemeColor(name: string, fallback: string) {
    if (typeof document === 'undefined') return fallback
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function useStoryStateGraphPaint() {
    const colorTheme = useAppThemeStore((state) => state.colorTheme)
    return useMemo(() => ({
        colorMode: (colorTheme === 'dark' ? 'dark' : 'light') as const,
        factActive: readThemeColor('--ss-fact-active', '#818cf8'),
        factStarts: readThemeColor('--ss-fact-starts', '#34d399'),
        factEnds: readThemeColor('--ss-fact-ends', '#fb7185'),
        dormant: readThemeColor('--ss-text-faint', '#475569'),
        minimapBg: readThemeColor('--ss-minimap-bg', '#070b1d'),
        minimapMask: readThemeColor('--ss-minimap-mask', 'rgba(15,23,42,0.32)'),
        minimapStroke: readThemeColor('--ss-minimap-stroke', '#67e8f9'),
        minimapNodeStroke: readThemeColor('--ss-minimap-node-stroke', 'rgba(224,242,254,0.8)'),
        dots: readThemeColor('--ss-dot', 'rgba(148,163,184,0.2)'),
    }), [colorTheme])
}

function StoryEntityNode({ data }: NodeProps<StoryEntityNode>) {
    const visibleLiteralFacts = data.literalFacts.slice(0, 3)
    return (
        <div
            className={cn(
                'onw-ss-node relative w-[210px] rounded-2xl px-3.5 py-3 backdrop-blur-xl transition-[opacity,filter,box-shadow,transform] duration-300',
                data.visualState === 'dormant' && 'opacity-25 grayscale',
                data.visualState === 'new' && 'onw-story-state-node-new is-new',
                data.visualState === 'ending' && 'is-ending',
                data.selected && 'ring-2 ring-ss-accent-2 ring-offset-2 ring-offset-ss-canvas'
            )}
        >
            <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-transparent" />
            <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent" />
            <div className="flex items-start gap-3">
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg', kindAccent(data.entity.kind))}>
                    {entityKindIcon(data.entity.kind)}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold tracking-wide">{data.entity.name}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-ss-text-muted">{data.entity.kind}</div>
                </div>
                {data.visualState === 'new' && <span className="rounded-full bg-ss-starts-fill px-2 py-0.5 text-[9px] font-bold tracking-widest text-ss-starts-text">NEW</span>}
            </div>
            {visibleLiteralFacts.length > 0 && (
                <div className="mt-3 space-y-1.5">
                    {visibleLiteralFacts.map(({ fact, state }) => (
                        <div
                            key={fact.id}
                            className={cn(
                                'truncate rounded-lg border border-ss-accent-border bg-ss-accent-soft px-2 py-1 text-[10px] text-ss-accent-text',
                                state === 'starts' && 'border-ss-starts-border bg-ss-starts-fill text-ss-starts-text',
                                state === 'ends' && 'border-ss-ends-border bg-ss-ends-fill text-ss-ends-text line-through decoration-ss-ends/70'
                            )}
                            title={fact.factText}
                        >
                            <span className="text-ss-text-muted">{fact.predicateKey}</span> · {fact.objectValue}
                        </div>
                    ))}
                </div>
            )}
            {data.literalFacts.length > visibleLiteralFacts.length && (
                <div className="mt-1.5 text-right text-[9px] text-ss-text-faint">+{data.literalFacts.length - visibleLiteralFacts.length}</div>
            )}
        </div>
    )
}

function StoryFactEdgeComponent({
    sourceX,
    sourceY,
    targetX,
    targetY,
    markerEnd,
    data,
}: EdgeProps<StoryFactEdge>) {
    const [path, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition: Position.Right,
        targetX,
        targetY,
        targetPosition: Position.Left,
        curvature: 0.22,
    })
    const state = data?.state ?? 'active'
    const color = factStroke(state)
    const selected = data?.selected ?? false

    return (
        <>
            <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={selected ? 13 : 8}
                opacity={selected ? 0.28 : 0.13}
                pointerEvents="none"
                className="onw-story-state-edge-glow"
            />
            <BaseEdge
                path={path}
                markerEnd={markerEnd}
                style={{
                    stroke: color,
                    strokeWidth: selected ? 3.2 : state === 'active' ? 1.8 : 2.5,
                    strokeDasharray: state === 'ends' ? '7 7' : state === 'starts' ? '4 8' : undefined,
                    opacity: state === 'ends' ? 0.86 : 0.95,
                }}
                className={cn(state !== 'active' && 'onw-story-state-edge-flow')}
            />
            <EdgeLabelRenderer>
                <div
                    className={cn(
                        'nodrag nopan pointer-events-none absolute max-w-40 -translate-x-1/2 -translate-y-1/2 truncate rounded-full border border-ss-accent-border bg-ss-node-bg px-2.5 py-1 text-[10px] font-semibold text-ss-accent-text shadow-lg backdrop-blur-md',
                        state === 'starts' && 'border-ss-starts-border text-ss-starts-text',
                        state === 'ends' && 'border-ss-ends-border text-ss-ends-text',
                        selected && 'ring-1 ring-ss-accent-2'
                    )}
                    style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
                    title={data?.fact.factText}
                >
                    {data?.fact.predicateKey}
                </div>
            </EdgeLabelRenderer>
        </>
    )
}

function buildLayout(entities: StoryStateVisualizationEntity[], facts: ResolvedStoryFact[]) {
    const nodeIds = new Set(entities.map((entity) => entity.id))
    const relationFacts = facts.filter((fact) => fact.credible
        && fact.objectEntityId
        && nodeIds.has(fact.subjectEntityId)
        && nodeIds.has(fact.objectEntityId))
    const degree = new Map<string, number>()
    for (const fact of relationFacts) {
        degree.set(fact.subjectEntityId, (degree.get(fact.subjectEntityId) ?? 0) + 1)
        degree.set(fact.objectEntityId!, (degree.get(fact.objectEntityId!) ?? 0) + 1)
    }
    const sorted = entities.slice().sort((a, b) =>
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
        || a.name.localeCompare(b.name)
        || a.id.localeCompare(b.id)
    )
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const layoutNodes: LayoutNode[] = sorted.map((entity, index) => ({
        id: entity.id,
        x: Math.cos(index * goldenAngle) * 115 * Math.sqrt(index),
        y: Math.sin(index * goldenAngle) * 90 * Math.sqrt(index),
    }))
    const links: LayoutLink[] = relationFacts.map((fact) => ({
        source: fact.subjectEntityId,
        target: fact.objectEntityId!,
    }))

    if (layoutNodes.length > 1) {
        const simulation = forceSimulation(layoutNodes)
            .force('link', forceLink<LayoutNode, LayoutLink>(links)
                .id((node) => node.id)
                .distance(255)
                .strength(0.38))
            .force('charge', forceManyBody<LayoutNode>().strength(-720).distanceMax(1100))
            .force('collision', forceCollide<LayoutNode>().radius(145).strength(1).iterations(3))
            .force('center', forceCenter(0, 0).strength(0.07))
            .stop()
        simulation.tick(Math.min(480, 260 + layoutNodes.length * 5))
    }

    return new Map(layoutNodes.map((node) => [node.id, {
        x: (node.x ?? 0) - NODE_WIDTH / 2,
        y: (node.y ?? 0) - 62,
    }] as const))
}

export function StoryStateGraph({
    entities,
    facts,
    selectedMoment,
    selectedEntityId,
    selectedFactId,
    onSelectEntity,
    onSelectFact,
}: {
    entities: StoryStateVisualizationEntity[]
    facts: ResolvedStoryFact[]
    selectedMoment: StoryStateVisualizationMoment | null
    selectedEntityId: string | null
    selectedFactId: string | null
    onSelectEntity: (entityId: string | null) => void
    onSelectFact: (factId: string | null) => void
}) {
    const paint = useStoryStateGraphPaint()
    const positions = useMemo(() => buildLayout(entities, facts), [entities, facts])
    const entityById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity] as const)), [entities])
    const credibleFacts = useMemo(() => facts.filter((fact) => fact.credible), [facts])
    const nodes = useMemo<StoryEntityNode[]>(() => entities.map((entity) => {
        const relatedFacts = credibleFacts.filter((fact) => storyFactTouchesEntity(fact, entity.id))
        const states = relatedFacts.map((fact) => getStoryFactMomentState(fact, selectedMoment))
        const firstOrder = firstActiveMomentOrderForEntity(credibleFacts, entity.id)
        let visualState: EntityVisualState = states.some((state) => state === 'starts')
            && firstOrder === selectedMoment?.storyOrder
            ? 'new'
            : states.some((state) => state === 'active' || state === 'starts')
                ? 'active'
                : states.some((state) => state === 'ends')
                    ? 'ending'
                    : 'dormant'
        if (credibleFacts.length === 0) visualState = 'active'

        const literalFacts = relatedFacts
            .filter((fact) => !fact.objectEntityId)
            .map((fact) => ({ fact, state: getStoryFactMomentState(fact, selectedMoment) }))
            .filter(({ state }) => state !== 'inactive')
        return {
            id: entity.id,
            type: 'storyEntity',
            position: positions.get(entity.id) ?? { x: 0, y: 0 },
            width: NODE_WIDTH,
            height: storyEntityNodeHeight(literalFacts.length),
            data: {
                entity,
                literalFacts,
                visualState,
                selected: selectedEntityId === entity.id,
            },
        }
    }), [credibleFacts, entities, positions, selectedEntityId, selectedMoment])

    const edges = useMemo<StoryFactEdge[]>(() => credibleFacts.flatMap((fact) => {
        if (!fact.objectEntityId || !entityById.has(fact.subjectEntityId) || !entityById.has(fact.objectEntityId)) return []
        const state = getStoryFactMomentState(fact, selectedMoment)
        if (state === 'inactive') return []
        return [{
            id: fact.id,
            type: 'storyFact',
            source: fact.subjectEntityId,
            target: fact.objectEntityId,
            markerEnd: { type: MarkerType.ArrowClosed, color: state === 'starts' ? paint.factStarts : state === 'ends' ? paint.factEnds : paint.factActive },
            data: { fact, state, selected: selectedFactId === fact.id },
        }]
    }), [credibleFacts, entityById, paint.factActive, paint.factEnds, paint.factStarts, selectedFactId, selectedMoment])

    if (entities.length === 0) return null

    return (
        <ReactFlow<StoryEntityNode, StoryFactEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={{ storyEntity: StoryEntityNode }}
            edgeTypes={{ storyFact: StoryFactEdgeComponent }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_, node) => {
                onSelectFact(null)
                onSelectEntity(node.id)
            }}
            onEdgeClick={(_, edge) => {
                onSelectEntity(null)
                onSelectFact(edge.id)
            }}
            onPaneClick={() => {
                onSelectEntity(null)
                onSelectFact(null)
            }}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
            minZoom={0.18}
            maxZoom={1.8}
            colorMode={paint.colorMode}
            proOptions={{ hideAttribution: true }}
        >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.1} color={paint.dots} />
            <Controls showInteractive={false} className="onw-ss-controls" />
            <MiniMap
                pannable
                zoomable
                bgColor={paint.minimapBg}
                className="onw-ss-minimap"
                maskColor={paint.minimapMask}
                maskStrokeColor={paint.minimapStroke}
                maskStrokeWidth={1.4}
                nodeBorderRadius={10}
                nodeStrokeColor={paint.minimapNodeStroke}
                nodeStrokeWidth={2}
                nodeColor={(node) => {
                    const visualState = (node as StoryEntityNode).data.visualState
                    if (visualState === 'new') return paint.factStarts
                    if (visualState === 'ending') return paint.factEnds
                    if (visualState === 'dormant') return paint.dormant
                    return paint.factActive
                }}
            />
        </ReactFlow>
    )
}
