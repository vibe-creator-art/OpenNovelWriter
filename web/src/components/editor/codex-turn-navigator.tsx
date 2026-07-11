'use client'

import { useMemo, useState, type MouseEvent } from 'react'

import { cn } from '@/lib/utils'

export type CodexTurnNavigatorEntry = {
    id: string
    userText: string
    assistantText: string
}

type CodexTurnNavigatorProps = {
    entries: CodexTurnNavigatorEntry[]
    activeIndex: number
    height: number
    onJump: (index: number) => void
}

const BASE_MARK_WIDTH = 9
const ACTIVE_MARK_WIDTH = 22
const HOVER_MARK_WIDTH = 46
const WAVE_RADIUS = 58

export function CodexTurnNavigator({
    entries,
    activeIndex,
    height,
    onJump,
}: CodexTurnNavigatorProps) {
    const [mouseY, setMouseY] = useState<number | null>(null)
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

    const markPositions = useMemo(() => {
        if (entries.length === 1) return [height / 2]
        const spacing = Math.min(20, Math.max(7, (height - 32) / Math.max(1, entries.length - 1)))
        const groupHeight = spacing * (entries.length - 1)
        const start = (height - groupHeight) / 2
        return entries.map((_, index) => start + index * spacing)
    }, [entries, height])

    if (entries.length === 0 || height <= 0) return null

    const updatePointer = (event: MouseEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const nextY = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
        setMouseY(nextY)

        let nearestIndex = 0
        let nearestDistance = Number.POSITIVE_INFINITY
        markPositions.forEach((position, index) => {
            const distance = Math.abs(position - nextY)
            if (distance < nearestDistance) {
                nearestDistance = distance
                nearestIndex = index
            }
        })
        setHoveredIndex(nearestIndex)
    }

    const previewTop = hoveredIndex === null
        ? 0
        : Math.max(70, Math.min(height - 70, markPositions[hoveredIndex] ?? 0))
    const preview = hoveredIndex === null ? null : entries[hoveredIndex]

    return (
        <nav
            aria-label="Codex conversation turns"
            className="pointer-events-auto absolute left-0 top-0 w-14 select-none"
            style={{ height }}
            onMouseMove={updatePointer}
            onMouseLeave={() => {
                setMouseY(null)
                setHoveredIndex(null)
            }}
        >
            {entries.map((entry, index) => {
                const position = markPositions[index] ?? 0
                const distance = mouseY === null ? Number.POSITIVE_INFINITY : Math.abs(position - mouseY)
                const influence = Math.max(0, 1 - distance / WAVE_RADIUS)
                const waveWidth = BASE_MARK_WIDTH + (HOVER_MARK_WIDTH - BASE_MARK_WIDTH) * influence * influence
                const width = index === hoveredIndex
                    ? HOVER_MARK_WIDTH
                    : Math.max(index === activeIndex ? ACTIVE_MARK_WIDTH : BASE_MARK_WIDTH, waveWidth)
                const emphasized = index === hoveredIndex || index === activeIndex

                return (
                    <button
                        key={entry.id}
                        type="button"
                        aria-label={`Jump to conversation turn ${index + 1}`}
                        className="group absolute left-0 flex h-5 w-14 -translate-y-1/2 items-center rounded-r-full outline-none"
                        style={{ top: position }}
                        onClick={() => onJump(index)}
                        onFocus={() => {
                            setMouseY(position)
                            setHoveredIndex(index)
                        }}
                        onBlur={() => {
                            setMouseY(null)
                            setHoveredIndex(null)
                        }}
                    >
                        <span
                            className={cn(
                                'block h-[3px] rounded-r-full transition-[width,background-color,opacity] duration-100 ease-out',
                                emphasized
                                    ? 'bg-foreground opacity-95'
                                    : 'bg-muted-foreground/35 group-hover:bg-muted-foreground/60'
                            )}
                            style={{ width }}
                        />
                    </button>
                )
            })}

            {preview && (
                <div
                    className="pointer-events-none absolute left-14 z-50 w-[min(28rem,calc(100vw-8rem))] -translate-y-1/2 overflow-hidden rounded-2xl border border-border/80 bg-background/95 px-4 py-3 shadow-[0_18px_48px_-22px_rgba(15,23,42,0.55)] backdrop-blur-xl"
                    style={{ top: previewTop }}
                >
                    <div className="line-clamp-1 text-sm font-semibold leading-6 text-foreground">
                        {preview.userText || '图片消息'}
                    </div>
                    <div className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {preview.assistantText || 'Codex 正在处理…'}
                    </div>
                </div>
            )}
        </nav>
    )
}
