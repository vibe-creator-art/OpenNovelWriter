'use client'

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { NovelWritingDay } from '@/lib/api'
import { cn } from '@/lib/utils'

const VIEW_H = 308
const PAD = { top: 28, right: 18, bottom: 54, left: 52 }
const BAR_BAND = 38

function formatSigned(value: number) {
    if (value > 0) return `+${value.toLocaleString()}`
    return value.toLocaleString()
}

function prefersReducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function toTime(dateKey: string) {
    return new Date(`${dateKey}T00:00:00`).getTime()
}

function catmullRomPath(points: Array<{ x: number; y: number }>) {
    if (points.length === 0) return ''
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
    let d = `M ${points[0].x} ${points[0].y}`
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] ?? points[i]
        const p1 = points[i]
        const p2 = points[i + 1]
        const p3 = points[i + 2] ?? p2
        d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`
    }
    return d
}

function useTweenedNumber(value: number, duration = 420) {
    const [display, setDisplay] = useState(value)
    const currentRef = useRef(value)
    const frameRef = useRef(0)

    useEffect(() => {
        const from = currentRef.current
        if (from === value) return
        if (prefersReducedMotion()) {
            currentRef.current = value
            setDisplay(value)
            return
        }
        const started = performance.now()
        const tick = (now: number) => {
            const t = Math.min(1, (now - started) / duration)
            const next = Math.round(from + (value - from) * (1 - (1 - t) ** 3))
            currentRef.current = next
            setDisplay(next)
            if (t < 1) frameRef.current = requestAnimationFrame(tick)
        }
        frameRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frameRef.current)
    }, [duration, value])

    return display
}

function easeOutCubic(t: number) {
    return 1 - (1 - t) ** 3
}

export function DailyWordChart({ days, range }: { days: NovelWritingDay[]; range: 30 | 90 | 'all' }) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    const chrono = useMemo(() => days.slice().reverse(), [days])
    const seriesKey = `${range}|${chrono.map((day) => `${day.dateKey}:${day.endingWordCount}:${day.netWordCount}`).join('|')}`

    useEffect(() => {
        const node = wrapRef.current
        if (!node) return
        const observer = new ResizeObserver((entries) => {
            const next = Math.round(entries[0]?.contentRect.width ?? 0)
            if (next > 0) setWidth(next)
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    return (
        <div
            ref={wrapRef}
            className="relative overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.10),transparent_58%)]"
            style={{ minHeight: VIEW_H }}
        >
            {width > 8 && chrono.length > 0 ? (
                <ChartScene key={seriesKey} days={chrono} width={width} />
            ) : null}
        </div>
    )
}

function ChartScene({ days, width }: { days: NovelWritingDay[]; width: number }) {
    const t = useTranslations('editor.reviewDashboard')
    const locale = useLocale()
    const uid = useId().replace(/:/g, '')
    const pathRef = useRef<SVGPathElement>(null)
    const [progress, setProgress] = useState(() => prefersReducedMotion() ? 1 : 0)
    const [head, setHead] = useState<{ x: number; y: number } | null>(null)
    const [hover, setHover] = useState<number | null>(null)
    const compact = useMemo(
        () => new Intl.NumberFormat(locale, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }),
        [locale]
    )

    const layout = useMemo(() => {
        const innerW = Math.max(1, width - PAD.left - PAD.right)
        const lineBottom = VIEW_H - PAD.bottom - BAR_BAND
        const lineTop = PAD.top
        const times = days.map((day) => toTime(day.dateKey))
        const totals = days.map((day) => day.endingWordCount)
        const minTime = times[0] ?? 0
        const maxTime = times[times.length - 1] ?? 1
        const minTotal = Math.min(...totals)
        const maxTotal = Math.max(...totals)
        const totalPad = Math.max(8, (maxTotal - minTotal) * 0.12) || Math.max(20, Math.abs(maxTotal) * 0.04)
        const xAt = (time: number) => {
            if (times.length <= 1) return PAD.left + innerW / 2
            return PAD.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * innerW
        }
        const yAt = (total: number) => {
            const lo = minTotal - totalPad
            const hi = maxTotal + totalPad
            return lineBottom - ((total - lo) / (hi - lo)) * (lineBottom - lineTop)
        }
        const points = days.map((day, index) => ({
            x: xAt(times[index]),
            y: yAt(day.endingWordCount),
            day,
        }))
        const linePath = catmullRomPath(points)
        const areaPath = points.length === 0
            ? ''
            : `${linePath} L ${points[points.length - 1].x} ${lineBottom} L ${points[0].x} ${lineBottom} Z`
        const maxAbsNet = Math.max(1, ...days.map((day) => Math.abs(day.netWordCount)))
        const barMid = lineBottom + 10 + BAR_BAND / 2
        const slot = innerW / Math.max(days.length, 1)
        const barW = Math.max(2, Math.min(9, slot * 0.42))
        const yTicks = minTotal === maxTotal
            ? [{ value: minTotal, y: yAt(minTotal) }]
            : [0, 0.5, 1].map((part) => {
                const value = minTotal + (maxTotal - minTotal) * part
                return { value, y: yAt(value) }
            })
        const xLabels = points.length <= 3
            ? points
            : [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]]
        return { innerW, lineBottom, points, linePath, areaPath, maxAbsNet, barMid, barW, yTicks, xLabels }
    }, [days, width])

    useEffect(() => {
        const reduced = prefersReducedMotion()
        const updateHead = (amount: number) => {
            const node = pathRef.current
            if (!node) return
            const length = node.getTotalLength()
            if (length <= 0) return
            const point = node.getPointAtLength(length * amount)
            setHead({ x: point.x, y: point.y })
        }
        if (reduced) {
            setProgress(1)
            updateHead(1)
            return
        }
        let frame = 0
        let start = 0
        const duration = Math.min(1500, 850 + days.length * 10)
        const tick = (now: number) => {
            if (!start) start = now
            const t = Math.min(1, (now - start) / duration)
            const amount = easeOutCubic(t)
            setProgress(amount)
            updateHead(amount)
            if (t < 1) frame = requestAnimationFrame(tick)
        }
        setProgress(0)
        frame = requestAnimationFrame(() => {
            updateHead(0)
            frame = requestAnimationFrame(tick)
        })
        return () => cancelAnimationFrame(frame)
    }, [days.length])

    const revealX = PAD.left + layout.innerW * progress
    const growing = progress < 0.999
    const showDots = days.length <= 40
    const revealedIndex = layout.points.reduce((last, point, index) => (point.x <= revealX + 0.5 ? index : last), 0)
    const active = hover === null ? layout.points[growing ? revealedIndex : layout.points.length - 1] : layout.points[hover]
    const tweened = useTweenedNumber(active?.day.endingWordCount ?? 0, growing ? 80 : 420)

    const onMove = (event: MouseEvent<SVGSVGElement>) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const svgX = ((event.clientX - rect.left) / rect.width) * width
        let best = 0
        let bestDist = Infinity
        layout.points.forEach((point, index) => {
            const dist = Math.abs(point.x - svgX)
            if (dist < bestDist) {
                best = index
                bestDist = dist
            }
        })
        setHover(best)
    }

    const tooltipLeft = active ? Math.min(width - 196, Math.max(12, active.x - 88)) : 12
    const headX = head?.x ?? layout.points[0]?.x ?? revealX
    const headY = head?.y ?? layout.points[0]?.y ?? 0

    return (
        <>
            <div className="pointer-events-none absolute right-4 top-3 z-10 text-right">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{t('endingTotal')}</div>
                <div className="text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{tweened.toLocaleString()}</div>
            </div>
            <svg
                width="100%"
                height={VIEW_H}
                viewBox={`0 0 ${width} ${VIEW_H}`}
                className="block"
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
                role="img"
                aria-label={t('chartView')}
            >
                <defs>
                    <linearGradient id={`${uid}-line`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#fb923c" />
                        <stop offset="100%" stopColor="#ea580c" />
                    </linearGradient>
                    <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(249,115,22,0.32)" />
                        <stop offset="100%" stopColor="rgba(249,115,22,0)" />
                    </linearGradient>
                    <clipPath id={`${uid}-grow`}>
                        <rect x={PAD.left} y={0} width={Math.max(0, layout.innerW * progress)} height={VIEW_H} />
                    </clipPath>
                </defs>

                {layout.yTicks.map((tick, index) => (
                    <g key={`${tick.y}-${index}`}>
                        <line
                            x1={PAD.left}
                            x2={width - PAD.right}
                            y1={tick.y}
                            y2={tick.y}
                            className="stroke-border/80"
                            strokeDasharray="3 5"
                        />
                        <text
                            x={PAD.left - 8}
                            y={tick.y + 3}
                            textAnchor="end"
                            className="fill-muted-foreground"
                            fontSize="10"
                        >
                            {compact.format(tick.value)}
                        </text>
                    </g>
                ))}

                <g clipPath={`url(#${uid}-grow)`}>
                    <path d={layout.areaPath} fill={`url(#${uid}-area)`} />
                    <path
                        ref={pathRef}
                        d={layout.linePath}
                        fill="none"
                        stroke={`url(#${uid}-line)`}
                        strokeWidth="2.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <line
                        x1={PAD.left}
                        x2={width - PAD.right}
                        y1={layout.barMid}
                        y2={layout.barMid}
                        className="stroke-border/70"
                    />
                    {days.map((day, index) => {
                        const point = layout.points[index]
                        const mag = (Math.abs(day.netWordCount) / layout.maxAbsNet) * ((BAR_BAND / 2) - 3)
                        const rising = day.netWordCount >= 0
                        return (
                            <rect
                                key={`bar-${day.dateKey}`}
                                x={point.x - layout.barW / 2}
                                y={rising ? layout.barMid - mag : layout.barMid}
                                width={layout.barW}
                                height={Math.max(1.5, mag)}
                                rx={1.5}
                                className={rising ? 'fill-emerald-500/80' : 'fill-rose-500/80'}
                            />
                        )
                    })}
                    {showDots && layout.points.map((point) => (
                        <circle
                            key={`dot-${point.day.dateKey}`}
                            cx={point.x}
                            cy={point.y}
                            r="3"
                            className="fill-orange-400 stroke-background"
                            strokeWidth="1.5"
                        />
                    ))}
                </g>

                {hover !== null && active && (
                    <line
                        x1={active.x}
                        x2={active.x}
                        y1={PAD.top}
                        y2={layout.lineBottom}
                        className="stroke-orange-400/50"
                        strokeDasharray="3 4"
                    />
                )}
                {(growing || hover === null) && (
                    <>
                        <circle cx={headX} cy={headY} r="10" className="fill-orange-400/25">
                            {!growing && !prefersReducedMotion() ? <animate attributeName="r" values="8;12;8" dur="2.2s" repeatCount="indefinite" /> : null}
                        </circle>
                        <circle cx={headX} cy={headY} r="4.25" className="fill-orange-500 stroke-background" strokeWidth="1.5" />
                    </>
                )}
                {hover !== null && active && (
                    <>
                        <circle cx={active.x} cy={active.y} r="6" className="fill-orange-400/25" />
                        <circle cx={active.x} cy={active.y} r="3.5" className="fill-orange-500 stroke-background" strokeWidth="1.5" />
                    </>
                )}

                {layout.xLabels.map((point) => (
                    <text
                        key={`x-${point.day.dateKey}`}
                        x={point.x}
                        y={VIEW_H - 16}
                        textAnchor="middle"
                        className="fill-muted-foreground"
                        fontSize="10"
                    >
                        {point.day.dateKey}
                    </text>
                ))}
            </svg>

            {active && hover !== null && (
                <div
                    className="pointer-events-none absolute z-20 min-w-[168px] rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
                    style={{ left: tooltipLeft, top: active.y < 96 ? active.y + 18 : Math.max(12, active.y - 78) }}
                >
                    <div className="font-medium">{active.day.dateKey}</div>
                    <div className="mt-1 flex justify-between gap-4 text-muted-foreground">
                        <span>{t('dailyChange')}</span>
                        <span className={cn('font-medium tabular-nums', active.day.netWordCount > 0 ? 'text-emerald-600' : active.day.netWordCount < 0 ? 'text-rose-600' : '')}>
                            {formatSigned(active.day.netWordCount)}
                        </span>
                    </div>
                    <div className="flex justify-between gap-4 text-muted-foreground">
                        <span>{t('endingTotal')}</span>
                        <span className="font-medium tabular-nums text-foreground">{active.day.endingWordCount.toLocaleString()}</span>
                    </div>
                </div>
            )}
        </>
    )
}
