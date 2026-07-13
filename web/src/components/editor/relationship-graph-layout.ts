import {
    forceCollide,
    forceLink,
    forceManyBody,
    forceRadial,
    forceSimulation,
    type SimulationLinkDatum,
    type SimulationNodeDatum,
} from 'd3-force'
import { MarkerType } from '@xyflow/react'
import type { TermEntry, TermEntryRelationDirection } from '@/components/editor/terms/types'
import type {
    TermGraphEdge,
    TermGraphNode,
    TermImportanceTier,
    TermLinkEmphasis,
} from '@/components/editor/relationship-graph-types'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const CLUSTER_PADDING = 48
const CLUSTER_GAP = 150
const LAYOUT_PADDING = 80

const NODE_SIZE_BY_TIER: Record<TermImportanceTier, number> = {
    core: 96,
    important: 74,
    minor: 54,
}

function motionDelayMs(id: string, cycleMs: number) {
    let hash = 0
    for (let index = 0; index < id.length; index += 1) {
        hash = (hash * 31 + id.charCodeAt(index)) >>> 0
    }
    return -(hash % cycleMs)
}

type GraphRelation = {
    id: string
    source: string
    target: string
    label?: string
    direction: TermEntryRelationDirection
}

type LayoutDatum = SimulationNodeDatum & {
    id: string
    size: number
    importance: number
    tier: TermImportanceTier
}

type LayoutLink = SimulationLinkDatum<LayoutDatum> & {
    source: string | LayoutDatum
    target: string | LayoutDatum
}

type LocalCluster = {
    id: string
    memberIds: string[]
    nodes: TermGraphNode[]
    width: number
    height: number
    maxImportance: number
}

type PlacedCluster = LocalCluster & {
    left: number
    top: number
    right: number
    bottom: number
}

function compareImportance(
    a: { id: string; importance: number; mentionCount: number; degree: number; title: string },
    b: { id: string; importance: number; mentionCount: number; degree: number; title: string }
) {
    return b.importance - a.importance
        || b.mentionCount - a.mentionCount
        || b.degree - a.degree
        || a.title.localeCompare(b.title)
        || a.id.localeCompare(b.id)
}

function buildRelations(entries: TermEntry[], nodeIdSet: Set<string>) {
    const seen = new Set<string>()
    const relations: GraphRelation[] = []

    for (const entry of entries) {
        if (!nodeIdSet.has(entry.id)) continue
        for (const relation of entry.relations ?? []) {
            if (!nodeIdSet.has(relation.otherId) || seen.has(relation.id)) continue
            seen.add(relation.id)
            const source = relation.direction === 'incoming' ? relation.otherId : entry.id
            const target = relation.direction === 'incoming' ? entry.id : relation.otherId
            relations.push({
                id: relation.id,
                source,
                target,
                label: relation.label?.trim() || undefined,
                direction: relation.direction,
            })
        }
    }

    return relations
}

function buildConnectedComponents(nodeIds: string[], relations: GraphRelation[]) {
    const adjacency = new Map(nodeIds.map((id) => [id, new Set<string>()] as const))
    for (const relation of relations) {
        adjacency.get(relation.source)?.add(relation.target)
        adjacency.get(relation.target)?.add(relation.source)
    }

    const visited = new Set<string>()
    const components: string[][] = []
    for (const startId of nodeIds) {
        if (visited.has(startId)) continue
        const component: string[] = []
        const queue = [startId]
        visited.add(startId)

        for (let index = 0; index < queue.length; index += 1) {
            const id = queue[index]
            component.push(id)
            const neighbors = Array.from(adjacency.get(id) ?? []).sort()
            for (const neighbor of neighbors) {
                if (visited.has(neighbor)) continue
                visited.add(neighbor)
                queue.push(neighbor)
            }
        }

        components.push(component)
    }
    return components
}

function runLocalLayout(
    clusterIndex: number,
    memberIds: string[],
    entryById: Map<string, TermEntry>,
    relationByNodeId: Map<string, GraphRelation[]>,
    importanceById: Map<string, { importance: number; tier: TermImportanceTier }>
): LocalCluster {
    const sortedIds = memberIds.slice().sort((a, b) => {
        const aImportance = importanceById.get(a)?.importance ?? 0
        const bImportance = importanceById.get(b)?.importance ?? 0
        return bImportance - aImportance || a.localeCompare(b)
    })

    const data: LayoutDatum[] = sortedIds.map((id, index) => {
        const importance = importanceById.get(id)
        const tier = importance?.tier ?? 'minor'
        const initialRadius = index === 0 ? 0 : 46 * Math.sqrt(index)
        return {
            id,
            size: NODE_SIZE_BY_TIER[tier],
            importance: importance?.importance ?? 0,
            tier,
            x: Math.cos(index * GOLDEN_ANGLE) * initialRadius,
            y: Math.sin(index * GOLDEN_ANGLE) * initialRadius,
            fx: index === 0 ? 0 : undefined,
            fy: index === 0 ? 0 : undefined,
        }
    })
    const memberIdSet = new Set(memberIds)
    const clusterRelations = new Map<string, GraphRelation>()
    for (const memberId of memberIds) {
        for (const relation of relationByNodeId.get(memberId) ?? []) {
            if (memberIdSet.has(relation.source) && memberIdSet.has(relation.target)) {
                clusterRelations.set(relation.id, relation)
            }
        }
    }
    const links: LayoutLink[] = Array.from(clusterRelations.values()).map((relation) => ({
        source: relation.source,
        target: relation.target,
    }))
    const datumById = new Map(data.map((datum) => [datum.id, datum] as const))

    const simulation = forceSimulation(data)
        .alphaDecay(0.025)
        .velocityDecay(0.42)
        .force('link', forceLink<LayoutDatum, LayoutLink>(links)
            .id((datum) => datum.id)
            .distance((link) => {
                const source = typeof link.source === 'string' ? datumById.get(link.source) : link.source
                const target = typeof link.target === 'string' ? datumById.get(link.target) : link.target
                return ((source?.size ?? 54) + (target?.size ?? 54)) / 2 + 64
            })
            .strength(0.42))
        .force('charge', forceManyBody<LayoutDatum>()
            .strength((datum) => -260 - datum.size * 2.6)
            .distanceMax(900))
        .force('collision', forceCollide<LayoutDatum>()
            .radius((datum) => datum.size / 2 + 22)
            .strength(1)
            .iterations(3))
        .force('importance', forceRadial<LayoutDatum>(
            (datum) => {
                if (datum.id === sortedIds[0]) return 0
                if (datum.tier === 'core') return 90
                if (datum.tier === 'important') return 165
                return 255
            },
            0,
            0
        ).strength(0.13))
        .stop()

    simulation.tick(Math.min(420, 240 + data.length * 3))

    let minLeft = Number.POSITIVE_INFINITY
    let minTop = Number.POSITIVE_INFINITY
    let maxRight = Number.NEGATIVE_INFINITY
    let maxBottom = Number.NEGATIVE_INFINITY
    for (const datum of data) {
        const x = datum.x ?? 0
        const y = datum.y ?? 0
        minLeft = Math.min(minLeft, x - datum.size / 2)
        minTop = Math.min(minTop, y - datum.size / 2)
        maxRight = Math.max(maxRight, x + datum.size / 2)
        maxBottom = Math.max(maxBottom, y + datum.size / 2)
    }

    const clusterId = `cluster-${clusterIndex}`
    const width = maxRight - minLeft + CLUSTER_PADDING * 2
    const height = maxBottom - minTop + CLUSTER_PADDING * 2
    const nodes: TermGraphNode[] = data.map((datum) => {
        const entry = entryById.get(datum.id)!
        return {
            id: datum.id,
            type: 'term',
            position: {
                x: (datum.x ?? 0) - datum.size / 2 - minLeft + CLUSTER_PADDING,
                y: (datum.y ?? 0) - datum.size / 2 - minTop + CLUSTER_PADDING,
            },
            data: {
                entry,
                size: datum.size,
                tier: datum.tier,
                motionDelayMs: motionDelayMs(datum.id, 4800),
                selected: false,
                dimmed: false,
            },
        }
    })

    return {
        id: clusterId,
        memberIds,
        nodes,
        width,
        height,
        maxImportance: Math.max(...data.map((datum) => datum.importance)),
    }
}

function overlapsWithGap(candidate: PlacedCluster, placed: PlacedCluster) {
    return !(
        candidate.right + CLUSTER_GAP <= placed.left
        || candidate.left >= placed.right + CLUSTER_GAP
        || candidate.bottom + CLUSTER_GAP <= placed.top
        || candidate.top >= placed.bottom + CLUSTER_GAP
    )
}

function placeClusters(clusters: LocalCluster[]) {
    const sorted = clusters.slice().sort((a, b) =>
        b.memberIds.length - a.memberIds.length
        || b.maxImportance - a.maxImportance
        || a.id.localeCompare(b.id)
    )
    const placed: PlacedCluster[] = []

    for (const cluster of sorted) {
        if (placed.length === 0) {
            placed.push({
                ...cluster,
                left: -cluster.width / 2,
                top: -cluster.height / 2,
                right: cluster.width / 2,
                bottom: cluster.height / 2,
            })
            continue
        }

        let next: PlacedCluster | null = null
        for (let attempt = 1; attempt <= 6000; attempt += 1) {
            const angle = attempt * GOLDEN_ANGLE
            const radius = 90 + 42 * Math.sqrt(attempt)
            const centerX = Math.cos(angle) * radius
            const centerY = Math.sin(angle) * radius
            const candidate: PlacedCluster = {
                ...cluster,
                left: centerX - cluster.width / 2,
                top: centerY - cluster.height / 2,
                right: centerX + cluster.width / 2,
                bottom: centerY + cluster.height / 2,
            }
            if (placed.every((other) => !overlapsWithGap(candidate, other))) {
                next = candidate
                break
            }
        }

        if (!next) {
            const right = Math.max(...placed.map((item) => item.right)) + CLUSTER_GAP
            next = {
                ...cluster,
                left: right,
                top: -cluster.height / 2,
                right: right + cluster.width,
                bottom: cluster.height / 2,
            }
        }
        placed.push(next)
    }

    const minLeft = Math.min(...placed.map((cluster) => cluster.left))
    const minTop = Math.min(...placed.map((cluster) => cluster.top))
    return placed.flatMap((cluster) => cluster.nodes.map((node) => ({
        ...node,
        position: {
            x: node.position.x + cluster.left - minLeft + LAYOUT_PADDING,
            y: node.position.y + cluster.top - minTop + LAYOUT_PADDING,
        },
    })))
}

export function buildRelationshipGraphLayout(entries: TermEntry[], mentionTotals: Map<string, number>) {
    const activeEntries = entries.filter((entry) => !entry.archived)
    const activeById = new Map(activeEntries.map((entry) => [entry.id, entry] as const))
    const relationEntries = activeEntries.filter((entry) =>
        (entry.relations ?? []).some((relation) => activeById.has(relation.otherId))
    )
    const nodeIdSet = new Set(relationEntries.map((entry) => entry.id))
    const relations = buildRelations(relationEntries, nodeIdSet)
    const degreeById = new Map<string, number>(relationEntries.map((entry) => [entry.id, 0]))
    const relationByNodeId = new Map(relationEntries.map((entry) => [entry.id, [] as GraphRelation[]] as const))
    for (const relation of relations) {
        degreeById.set(relation.source, (degreeById.get(relation.source) ?? 0) + 1)
        degreeById.set(relation.target, (degreeById.get(relation.target) ?? 0) + 1)
        relationByNodeId.get(relation.source)?.push(relation)
        relationByNodeId.get(relation.target)?.push(relation)
    }

    const maxMentionLog = Math.max(0, ...relationEntries.map((entry) => Math.log1p(mentionTotals.get(entry.id) ?? 0)))
    const maxDegreeLog = Math.max(0, ...relationEntries.map((entry) => Math.log1p(degreeById.get(entry.id) ?? 0)))
    const ranked = relationEntries.map((entry) => {
        const mentionCount = mentionTotals.get(entry.id) ?? 0
        const degree = degreeById.get(entry.id) ?? 0
        const mentionScore = maxMentionLog > 0 ? Math.log1p(mentionCount) / maxMentionLog : 0
        const degreeScore = maxDegreeLog > 0 ? Math.log1p(degree) / maxDegreeLog : 0
        return {
            id: entry.id,
            title: entry.title,
            mentionCount,
            degree,
            importance: mentionScore * 0.75 + degreeScore * 0.25,
        }
    }).sort(compareImportance)

    const minimumCoreCount = ranked.length >= 2 ? 2 : ranked.length
    const coreCount = Math.min(3, Math.max(minimumCoreCount, Math.round(ranked.length * 0.04)))
    const importantEnd = Math.max(coreCount, Math.round(ranked.length * 0.22))
    const importanceById = new Map(ranked.map((item, index) => {
        const tier: TermImportanceTier = index < coreCount
            ? 'core'
            : index < importantEnd
                ? 'important'
                : 'minor'
        return [item.id, { importance: item.importance, tier }] as const
    }))

    const components = buildConnectedComponents(ranked.map((item) => item.id), relations)
    const localClusters = components.map((memberIds, index) => runLocalLayout(
        index,
        memberIds,
        activeById,
        relationByNodeId,
        importanceById
    ))
    const nodes = localClusters.length > 0 ? placeClusters(localClusters) : []
    const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
    const edges: TermGraphEdge[] = relations.map((relation) => {
        const sourceNode = nodeById.get(relation.source)!
        const targetNode = nodeById.get(relation.target)!
        const sourceTier = sourceNode.data.tier
        const targetTier = targetNode.data.tier
        let emphasis: TermLinkEmphasis = 'normal'
        if (sourceTier === 'core' && targetTier === 'core') {
            emphasis = 'core'
        } else if (
            (sourceTier === 'core' && targetTier === 'important')
            || (sourceTier === 'important' && targetTier === 'core')
        ) {
            emphasis = 'important'
        }
        const backbone = sourceNode.data.tier !== 'minor' || targetNode.data.tier !== 'minor'
        return {
            id: relation.id,
            type: 'relationship',
            source: relation.source,
            target: relation.target,
            markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11 },
            markerStart: relation.direction === 'bidirectional'
                ? { type: MarkerType.ArrowClosed, width: 11, height: 11 }
                : undefined,
            data: {
                label: relation.label,
                direction: relation.direction,
                sourceSize: sourceNode.data.size,
                targetSize: targetNode.data.size,
                emphasis,
                motionDelayMs: motionDelayMs(relation.id, 1600),
                backbone,
                highlighted: false,
                selectionActive: false,
            },
        }
    })

    return { nodes, edges }
}
