'use client'

import { useTranslations } from 'next-intl'
import { Check, EyeOff, Search, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TermEntryAiContextPolicy } from '@/components/editor/terms/types'

type TermEntryTrackingTabProps = {
    value: TermEntryAiContextPolicy
    onChange: (next: TermEntryAiContextPolicy) => void
}

const OPTIONS: Array<{
    id: TermEntryAiContextPolicy
    icon: typeof Zap
    iconWrapClassName: string
    selectedClassName: string
}> = [
    {
        id: 'always',
        icon: Zap,
        iconWrapClassName: 'bg-blue-500/10 text-blue-700 dark:text-blue-200',
        selectedClassName: 'border-blue-200 bg-blue-50/70 dark:border-blue-900/40 dark:bg-blue-950/25',
    },
    {
        id: 'detected',
        icon: Search,
        iconWrapClassName: 'bg-muted text-foreground',
        selectedClassName: 'border-foreground/20 bg-muted/20',
    },
    {
        id: 'never',
        icon: EyeOff,
        iconWrapClassName: 'bg-muted/50 text-muted-foreground',
        selectedClassName: 'border-border bg-muted/30',
    },
]

export function TermEntryTrackingTab({ value, onChange }: TermEntryTrackingTabProps) {
    const t = useTranslations('editor')

    return (
        <div role="radiogroup" aria-label={t('terms.panel.tabs.tracking')} className="p-4 space-y-2">
            {OPTIONS.map((option) => {
                const selected = value === option.id
                const Icon = option.icon

                return (
                    <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(option.id)}
                        className={cn(
                            'w-full text-left rounded-lg border px-3 py-2.5 flex items-center gap-3 transition-colors',
                            'hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                            selected ? option.selectedClassName : 'border-transparent bg-card'
                        )}
                    >
                        <span className={cn('h-9 w-9 rounded-md border flex items-center justify-center', option.iconWrapClassName)}>
                            <Icon className="h-4 w-4" />
                        </span>

                        <span className="min-w-0 flex-1 text-sm font-medium">
                            {t(`terms.panel.tracking.${option.id}`)}
                        </span>

                        {selected && (
                            <span className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full bg-foreground/5">
                                <Check className="h-4 w-4 text-foreground" />
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}

