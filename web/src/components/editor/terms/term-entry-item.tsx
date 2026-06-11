import { cn } from '@/lib/utils'
import { renderIconSpec } from '@/components/editor/terms/utils'
import { CroppedImage } from '@/components/image/cropped-image'
import { parseImageCrop } from '@/lib/image-crop'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import { EyeOff, Zap } from 'lucide-react'
import type { CustomCategoryIcon, TermEntry } from '@/components/editor/terms/types'

type TermEntryItemProps = {
    entry: TermEntry
    selected: boolean
    isCompact: boolean
    onSelect: () => void
    fallbackIcon: CustomCategoryIcon
}

export function TermEntryItem({ entry, selected, isCompact, onSelect, fallbackIcon }: TermEntryItemProps) {
    const colorId = getTermEntryColorId(entry.color)
    const colorClasses = getTermEntryColorClasses(colorId)
    const titleAccent = colorId !== 'black'
    const iconAccent = !entry.avatar && titleAccent
    const aiContextPolicy = entry.aiContextPolicy ?? 'detected'
    const alwaysInclude = aiContextPolicy === 'always'
    const neverInclude = aiContextPolicy === 'never'

    const baseBarClassName = selected
        ? 'ring-1 ring-primary/20'
        : alwaysInclude
            ? 'hover:bg-blue-50/70 dark:hover:bg-blue-950/20'
            : neverInclude
                ? 'hover:bg-muted/40'
                : 'hover:bg-muted'

    const barClassName = selected
        ? alwaysInclude
            ? 'bg-gradient-to-r from-blue-50/90 to-background border-blue-200/70 dark:from-blue-950/25 dark:border-blue-900/40'
            : neverInclude
                ? 'bg-gradient-to-r from-muted/40 to-background border-border/70'
                : 'bg-muted border-primary/30'
        : alwaysInclude
            ? 'bg-gradient-to-r from-blue-50/70 to-background border-blue-200/50 dark:from-blue-950/20 dark:border-blue-900/35'
            : neverInclude
                ? 'bg-gradient-to-r from-muted/25 to-background border-border/50'
                : 'border-transparent'

    return (
        <button
            type="button"
            onClick={onSelect}
            data-term-entry-trigger="true"
            data-term-entry-id={entry.id}
            className={cn(
                'relative overflow-hidden w-full text-left flex items-center gap-2 px-2 py-2 rounded-md transition-colors border',
                baseBarClassName,
                barClassName
            )}
        >
            {(alwaysInclude || neverInclude) && (
                <span
                    aria-hidden="true"
                    className={cn(
                        'absolute inset-y-0 left-0 w-1',
                        alwaysInclude
                            ? 'bg-gradient-to-b from-blue-500 to-cyan-400'
                            : 'bg-gradient-to-b from-muted-foreground/50 to-muted-foreground/10'
                    )}
                />
            )}

            <span
                className={cn(
                    'h-7 w-7 shrink-0 rounded-full border overflow-hidden flex items-center justify-center',
                    entry.avatar
                        ? 'bg-background text-muted-foreground'
                        : iconAccent
                            ? `${colorClasses.subtleBg} ${colorClasses.subtleBorder}`
                            : 'bg-background text-muted-foreground'
                )}
            >
                {entry.avatar ? (
                    <CroppedImage src={entry.avatar} crop={parseImageCrop(entry.avatarCrop)} aspectRatio={1} className="h-full w-full" />
                ) : (
                    <span className="[&_svg]:h-4 [&_svg]:w-4">
                        {renderIconSpec(fallbackIcon, cn('h-4 w-4', iconAccent ? colorClasses.icon : 'text-muted-foreground'))}
                    </span>
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className={cn('block truncate', selected ? 'font-semibold' : 'font-medium', titleAccent && colorClasses.text)}>
                    {entry.title}
                </span>
                {!isCompact && entry.subtitle && (
                    <span className="block truncate text-xs text-muted-foreground">{entry.subtitle}</span>
                )}
            </span>

            {alwaysInclude && (
                <span
                    aria-hidden="true"
                    className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full border bg-blue-500/10 text-blue-700 dark:text-blue-200"
                >
                    <Zap className="h-4 w-4" />
                </span>
            )}

            {neverInclude && (
                <span
                    aria-hidden="true"
                    className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full border bg-muted/40 text-muted-foreground"
                >
                    <EyeOff className="h-4 w-4" />
                </span>
            )}
        </button>
    )
}
