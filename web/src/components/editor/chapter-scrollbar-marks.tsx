'use client'

import { useEffect, useMemo, useState } from 'react'
import { dispatchWriteJump } from '@/components/editor/write-jump-events'

type ScrollbarMark = {
    chapterId: string
    topPercent: number
}

interface ChapterScrollbarMarksProps {
    scrollContainerRef: React.RefObject<HTMLElement | null>
    contentRef: React.RefObject<HTMLElement | null>
    chapterIds: string[]
    enabled?: boolean
}

export function ChapterScrollbarMarks({
    scrollContainerRef,
    contentRef,
    chapterIds,
    enabled = true,
}: ChapterScrollbarMarksProps) {
    const [marks, setMarks] = useState<ScrollbarMark[]>([])

    const chapterIdSet = useMemo(() => new Set(chapterIds), [chapterIds])

    useEffect(() => {
        if (!enabled) return

        const root = scrollContainerRef.current
        const content = contentRef.current
        if (!root || !content) return

        let rafId: number | null = null

        const computeMarks = () => {
            const scrollHeight = root.scrollHeight
            if (!Number.isFinite(scrollHeight) || scrollHeight <= root.clientHeight + 1) {
                setMarks([])
                return
            }

            const rootRect = root.getBoundingClientRect()
            const next: ScrollbarMark[] = []

            const chapterElements = Array.from(content.querySelectorAll<HTMLElement>('[id^="chapter-"]'))
            for (const el of chapterElements) {
                const chapterId = el.id.replace(/^chapter-/, '')
                if (!chapterIdSet.has(chapterId)) continue

                const rect = el.getBoundingClientRect()
                const offsetTop = rect.top - rootRect.top + root.scrollTop
                const topPercent = Math.min(1, Math.max(0, offsetTop / scrollHeight))
                next.push({ chapterId, topPercent })
            }

            next.sort((a, b) => a.topPercent - b.topPercent)
            setMarks(next)
        }

        const scheduleCompute = () => {
            if (rafId !== null) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                rafId = null
                computeMarks()
            })
        }

        scheduleCompute()

        const ro = new ResizeObserver(() => scheduleCompute())
        ro.observe(root)
        ro.observe(content)

        return () => {
            ro.disconnect()
            if (rafId !== null) cancelAnimationFrame(rafId)
        }
    }, [enabled, scrollContainerRef, contentRef, chapterIdSet])

    if (!enabled || marks.length === 0) return null

    return (
        <div
            className="pointer-events-none absolute top-0 bottom-0 z-10"
            style={{
                right: 'var(--onw-scrollbar-size, 6px)',
                width: 8,
            }}
        >
            {marks.map((mark) => (
                <button
                    key={mark.chapterId}
                    type="button"
                    tabIndex={-1}
                    aria-label={`Jump to chapter ${mark.chapterId}`}
                    title="Jump to chapter"
                    className="pointer-events-auto absolute right-0 -translate-y-1/2 h-4 w-4 flex items-center justify-end group"
                    style={{ top: `clamp(8px, ${mark.topPercent * 100}%, calc(100% - 8px))` }}
                    onClick={() => {
                        dispatchWriteJump({ chapterId: mark.chapterId, source: 'scrollbar' })
                    }}
                >
                    <span className="block h-0.5 w-2 rounded bg-muted-foreground/35 group-hover:bg-muted-foreground/60 group-active:bg-muted-foreground/70" />
                </button>
            ))}
        </div>
    )
}
