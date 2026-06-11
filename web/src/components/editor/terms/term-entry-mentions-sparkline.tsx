import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

type TermEntryMentionsSparklineProps = {
    count: number
    sceneMentions?: number[]
}

function bucketizeSceneMentions(sceneMentions: number[], maxPoints: number) {
    if (sceneMentions.length <= maxPoints) return sceneMentions.slice()
    const bucketSize = sceneMentions.length / maxPoints
    const buckets: number[] = []

    for (let i = 0; i < maxPoints; i += 1) {
        const start = Math.floor(i * bucketSize)
        const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize))

        let value = 0
        for (let j = start; j < end && j < sceneMentions.length; j += 1) {
            if (sceneMentions[j]) {
                value = 1
                break
            }
        }
        buckets.push(value)
    }

    return buckets
}

function buildSparklinePath(values: number[], baseline: number, peak: number) {
    const clamped = values.map((value) => Math.max(0, Math.min(1, value)))
    const n = clamped.length
    const width = 100
    if (n <= 1) {
        const y = baseline.toFixed(2)
        return {
            line: `M 0 ${y} L ${width} ${y}`,
            area: `M 0 ${y} L ${width} ${y} L ${width} ${y} L 0 ${y} Z`,
        }
    }

    const amplitude = baseline - peak
    const step = width / (n - 1)
    const points = clamped.map((value, idx) => {
        const x = idx * step
        const y = baseline - value * amplitude
        return { x, y }
    })

    const lineParts: string[] = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`]
    for (let i = 1; i < points.length; i += 1) {
        lineParts.push(`L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`)
    }

    const line = lineParts.join(' ')
    const lastX = points[points.length - 1].x.toFixed(2)
    const baseY = baseline.toFixed(2)
    const area = `${line} L ${lastX} ${baseY} L 0 ${baseY} Z`

    return { line, area }
}

export function TermEntryMentionsSparkline({ count, sceneMentions = [] }: TermEntryMentionsSparklineProps) {
    const t = useTranslations('editor')

    const paths = useMemo(() => {
        const baseline = 22
        const peak = 6

        if (sceneMentions.length === 0) {
            return buildSparklinePath([0, 0], baseline, peak)
        }

        const maxPoints = 96
        const bucketed = bucketizeSceneMentions(sceneMentions, maxPoints)
        return buildSparklinePath(bucketed, baseline, peak)
    }, [sceneMentions])

    return (
        <div className="flex items-center gap-4">
            <div className="flex-1">
                <svg viewBox="0 0 100 24" className="h-8 w-full" preserveAspectRatio="none" aria-hidden="true">
                    <path d={paths.area} fill="currentColor" opacity="0.16" className="text-muted-foreground" />
                    <path
                        d={paths.line}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        className="text-muted-foreground"
                        style={{ filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.22))' }}
                    />
                </svg>
            </div>
            <div className="text-lg font-semibold text-foreground tabular-nums whitespace-nowrap">
                {t('terms.panel.mentionsCount', { count })}
            </div>
        </div>
    )
}
