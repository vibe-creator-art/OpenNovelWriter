'use client'

import {
    BaseEdge,
    EdgeLabelRenderer,
    Position,
    getBezierPath,
    useStore,
    type EdgeProps,
} from '@xyflow/react'
import type { TermGraphEdge } from '@/components/editor/relationship-graph-types'

function edgePositions(dx: number, dy: number) {
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0
            ? [Position.Right, Position.Left] as const
            : [Position.Left, Position.Right] as const
    }
    return dy >= 0
        ? [Position.Bottom, Position.Top] as const
        : [Position.Top, Position.Bottom] as const
}

function wavePath(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    distance: number
) {
    const dx = targetX - sourceX
    const dy = targetY - sourceY
    const normalX = -dy / distance
    const normalY = dx / distance
    const cycles = Math.max(2, Math.min(6, Math.round(distance / 115)))
    const samples = cycles * 16
    const amplitude = Math.min(11, Math.max(7, distance / 45))
    const points = [`M ${sourceX.toFixed(2)} ${sourceY.toFixed(2)}`]

    for (let index = 1; index <= samples; index += 1) {
        const progress = index / samples
        const envelope = Math.sin(Math.PI * progress)
        const offset = Math.sin(progress * cycles * Math.PI * 2) * amplitude * envelope
        const x = sourceX + dx * progress + normalX * offset
        const y = sourceY + dy * progress + normalY * offset
        points.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`)
    }
    return points.join(' ')
}

export function RelationshipGraphEdge({
    sourceX,
    sourceY,
    targetX,
    targetY,
    markerStart,
    markerEnd,
    interactionWidth,
    style,
    data,
}: EdgeProps<TermGraphEdge>) {
    const detailLevel = useStore((state) => {
        const zoom = state.transform[2]
        if (zoom >= 1.05) return 2
        if (zoom >= 0.72) return 1
        return 0
    })
    const dx = targetX - sourceX
    const dy = targetY - sourceY
    const distance = Math.hypot(dx, dy) || 1
    const unitX = dx / distance
    const unitY = dy / distance
    const sourceRadius = (data?.sourceSize ?? 54) / 2 + 1
    const targetRadius = (data?.targetSize ?? 54) / 2 + 2
    const edgeSourceX = sourceX + unitX * sourceRadius
    const edgeSourceY = sourceY + unitY * sourceRadius
    const edgeTargetX = targetX - unitX * targetRadius
    const edgeTargetY = targetY - unitY * targetRadius
    const [sourcePosition, targetPosition] = edgePositions(dx, dy)
    const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath({
        sourceX: edgeSourceX,
        sourceY: edgeSourceY,
        sourcePosition,
        targetX: edgeTargetX,
        targetY: edgeTargetY,
        targetPosition,
        curvature: 0.18,
    })

    const highlighted = data?.highlighted ?? false
    const selectionActive = data?.selectionActive ?? false
    const backbone = data?.backbone ?? false
    const emphasis = data?.emphasis ?? 'normal'
    const isCore = emphasis === 'core'
    const isImportant = emphasis === 'important'
    const path = isCore
        ? wavePath(edgeSourceX, edgeSourceY, edgeTargetX, edgeTargetY, distance)
        : bezierPath
    const labelX = isCore ? (edgeSourceX + edgeTargetX) / 2 : bezierLabelX
    const labelY = isCore ? (edgeSourceY + edgeTargetY) / 2 : bezierLabelY
    let opacity = 0.035
    if (selectionActive) {
        opacity = highlighted ? 1 : 0.025
    } else if (isCore) {
        opacity = 0.96
    } else if (isImportant) {
        opacity = 0.68
    } else if (backbone) {
        opacity = 0.42
    } else if (detailLevel > 0) {
        opacity = 0.18
    }

    let stroke = 'var(--xy-edge-stroke, #a8a29e)'
    if (highlighted) stroke = '#fb923c'
    else if (isCore) stroke = '#facc15'
    else if (isImportant) stroke = '#f59e0b'

    let strokeWidth = backbone ? 1.45 : 1.1
    if (highlighted) strokeWidth = isCore ? 4.8 : 3
    else if (isCore) strokeWidth = 4
    else if (isImportant) strokeWidth = 2.4
    const showLabel = Boolean(data?.label && (highlighted || detailLevel === 2))

    return (
        <>
            {(isCore || isImportant) && (
                <path
                    d={path}
                    fill="none"
                    stroke={stroke}
                    strokeLinecap="round"
                    strokeWidth={isCore ? 18 : 8}
                    opacity={opacity * (highlighted ? 0.58 : isCore ? 0.46 : 0.18)}
                    className="onw-relationship-energy-glow"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                />
            )}
            <BaseEdge
                path={path}
                markerStart={markerStart}
                markerEnd={markerEnd}
                interactionWidth={interactionWidth}
                style={{
                    ...style,
                    opacity,
                    stroke,
                    strokeWidth,
                    transition: 'opacity 180ms ease, stroke 180ms ease, stroke-width 180ms ease',
                }}
            />
            {isCore && (
                <path
                    d={path}
                    fill="none"
                    stroke={highlighted ? '#fff7ed' : '#fffbd5'}
                    strokeDasharray="5 11"
                    strokeLinecap="round"
                    strokeWidth={3.4}
                    opacity={opacity}
                    className="onw-relationship-energy-flow"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                    aria-hidden="true"
                    style={{ animationDelay: `${data?.motionDelayMs ?? 0}ms` }}
                />
            )}
            {showLabel && (
                <EdgeLabelRenderer>
                    <div
                        className="nodrag nopan pointer-events-none absolute rounded-full border bg-background/95 px-2 py-1 text-[11px] font-semibold text-foreground shadow-sm"
                        style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
                    >
                        {data?.label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    )
}
