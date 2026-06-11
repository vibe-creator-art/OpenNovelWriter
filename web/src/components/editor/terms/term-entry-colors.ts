import type { TermEntryColorId } from '@/components/editor/terms/types'

export const TERM_ENTRY_COLOR_IDS: readonly TermEntryColorId[] = [
    'black',
    'gray',
    'brown',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'pink',
    'red',
]

export const TERM_ENTRY_COLOR_ID_SET = new Set<string>(TERM_ENTRY_COLOR_IDS)

export function coerceTermEntryColorId(raw: unknown): TermEntryColorId | null {
    if (typeof raw !== 'string') return null
    return TERM_ENTRY_COLOR_ID_SET.has(raw) ? (raw as TermEntryColorId) : null
}

export function getTermEntryColorId(raw: unknown): TermEntryColorId {
    return coerceTermEntryColorId(raw) ?? 'black'
}

export type TermEntryColorClasses = {
    dot: string
    text: string
    icon: string
    subtleBg: string
    subtleBorder: string
}

export function getTermEntryColorClasses(colorId: TermEntryColorId): TermEntryColorClasses {
    switch (colorId) {
        case 'gray':
            return {
                dot: 'bg-slate-400',
                text: 'text-slate-600',
                icon: 'text-slate-600',
                subtleBg: 'bg-slate-50',
                subtleBorder: 'border-slate-200',
            }
        case 'brown':
            return {
                dot: 'bg-amber-700',
                text: 'text-amber-700',
                icon: 'text-amber-700',
                subtleBg: 'bg-amber-50',
                subtleBorder: 'border-amber-200',
            }
        case 'orange':
            return {
                dot: 'bg-orange-500',
                text: 'text-orange-600',
                icon: 'text-orange-600',
                subtleBg: 'bg-orange-50',
                subtleBorder: 'border-orange-200',
            }
        case 'yellow':
            return {
                dot: 'bg-yellow-400',
                text: 'text-yellow-600',
                icon: 'text-yellow-600',
                subtleBg: 'bg-yellow-50',
                subtleBorder: 'border-yellow-200',
            }
        case 'green':
            return {
                dot: 'bg-emerald-500',
                text: 'text-emerald-600',
                icon: 'text-emerald-600',
                subtleBg: 'bg-emerald-50',
                subtleBorder: 'border-emerald-200',
            }
        case 'blue':
            return {
                dot: 'bg-blue-500',
                text: 'text-blue-600',
                icon: 'text-blue-600',
                subtleBg: 'bg-blue-50',
                subtleBorder: 'border-blue-200',
            }
        case 'purple':
            return {
                dot: 'bg-purple-500',
                text: 'text-purple-600',
                icon: 'text-purple-600',
                subtleBg: 'bg-purple-50',
                subtleBorder: 'border-purple-200',
            }
        case 'pink':
            return {
                dot: 'bg-pink-500',
                text: 'text-pink-600',
                icon: 'text-pink-600',
                subtleBg: 'bg-pink-50',
                subtleBorder: 'border-pink-200',
            }
        case 'red':
            return {
                dot: 'bg-red-500',
                text: 'text-red-600',
                icon: 'text-red-600',
                subtleBg: 'bg-red-50',
                subtleBorder: 'border-red-200',
            }
        case 'black':
        default:
            return {
                dot: 'bg-foreground',
                text: 'text-foreground',
                icon: 'text-muted-foreground',
                subtleBg: 'bg-muted',
                subtleBorder: 'border-border',
            }
    }
}

