import type { Edge, Node } from '@xyflow/react'
import type { TermEntry, TermEntryRelationDirection } from '@/components/editor/terms/types'

export type TermImportanceTier = 'core' | 'important' | 'minor'
export type TermLinkEmphasis = 'core' | 'important' | 'normal'

export type TermGraphNodeData = {
    entry: TermEntry
    size: number
    tier: TermImportanceTier
    motionDelayMs: number
    selected: boolean
    dimmed: boolean
}

export type TermGraphNode = Node<TermGraphNodeData, 'term'>

export type TermGraphEdgeData = {
    label?: string
    direction: TermEntryRelationDirection
    sourceSize: number
    targetSize: number
    emphasis: TermLinkEmphasis
    motionDelayMs: number
    backbone: boolean
    highlighted: boolean
    selectionActive: boolean
}

export type TermGraphEdge = Edge<TermGraphEdgeData, 'relationship'>
