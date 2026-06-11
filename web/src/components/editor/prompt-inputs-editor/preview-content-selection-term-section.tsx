'use client'

import type { ContentSelectionTarget } from '@/lib/prompt-inputs'
import type { TermPickerCategoryFilter } from '@/components/editor/prompt-inputs-editor/types'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    DropdownMenuCheckboxItem,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Ban, BookText, MapPin, MoreHorizontal, Search, Shapes, UserRound } from 'lucide-react'
import { isDefaultTermCategoryId, selectionKey } from '@/components/editor/prompt-inputs-editor/utils'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import type { PreviewContentSelectionSectionProps } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'

export function PreviewContentSelectionTermSection({
    model,
    controller,
}: PreviewContentSelectionSectionProps) {
    const {
        t,
        tTerms,
        novelId,
        setTermPickerCategory,
        setTermPickerQuery,
        termPickerCategory,
        termPickerItems,
        termPickerQuery,
    } = model
    const { allowMultiple, enabled, state, selectedKeys, addOrRemove, selectSingle, clearSelections } = controller

    return (
        <>
			                                                    {enabled.term.enabled && (
			                                                        <>
			                                                            <DropdownMenuSeparator />
			                                                            <DropdownMenuSub
			                                                                onOpenChange={(open) => {
			                                                                    if (!open) return
			                                                                    setTermPickerQuery('')
			                                                                    setTermPickerCategory('all')
			                                                                }}
			                                                            >
			                                                                <DropdownMenuSubTrigger disabled={!novelId}>
			                                                                    {t('advanced.contentSelection.term')}
			                                                                </DropdownMenuSubTrigger>
			                                                                <DropdownMenuSubContent className="min-w-[360px]">
			                                                                    <div className="p-2 space-y-2">
			                                                                        <div className="relative">
			                                                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
			                                                                            <Input
			                                                                                value={termPickerQuery}
			                                                                                onChange={(e) => setTermPickerQuery(e.target.value)}
			                                                                                onKeyDown={(e) => e.stopPropagation()}
			                                                                                placeholder={t(
			                                                                                    'advanced.contentSelection.termPicker.searchPlaceholder'
			                                                                                )}
			                                                                                className="pl-8 h-8 text-sm"
			                                                                            />
			                                                                        </div>

			                                                                        {(() => {
			                                                                            const allowed = enabled.term.allowedTypes
			                                                                            const availableFilters: TermPickerCategoryFilter[] = [
			                                                                                'all',
			                                                                            ]
			                                                                            if (allowed.characters) availableFilters.push('characters')
			                                                                            if (allowed.locations) availableFilters.push('locations')
			                                                                            if (allowed.items) availableFilters.push('items')
			                                                                            if (allowed.lore) availableFilters.push('lore')
			                                                                            if (allowed.others) availableFilters.push('others')

			                                                                            const effectiveFilter: TermPickerCategoryFilter =
			                                                                                availableFilters.includes(termPickerCategory)
			                                                                                    ? termPickerCategory
			                                                                                    : 'all'

			                                                                            return (
			                                                                                <div className="flex flex-wrap gap-1">
			                                                                                    <button
			                                                                                        type="button"
			                                                                                        className={cn(
			                                                                                            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
			                                                                                            effectiveFilter === 'all'
			                                                                                                ? 'bg-foreground text-background'
			                                                                                                : 'bg-muted/20 text-foreground hover:bg-muted/40'
			                                                                                        )}
			                                                                                        onClick={() => setTermPickerCategory('all')}
			                                                                                    >
			                                                                                        {t('advanced.contentSelection.termPicker.filterAll')}
			                                                                                    </button>

			                                                                                    {allowed.characters && (
			                                                                                        <button
			                                                                                            type="button"
			                                                                                            className={cn(
			                                                                                                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
			                                                                                                effectiveFilter ===
			                                                                                                    'characters'
			                                                                                                    ? 'bg-foreground text-background'
			                                                                                                    : 'bg-muted/20 text-foreground hover:bg-muted/40'
			                                                                                            )}
			                                                                                            onClick={() =>
			                                                                                                setTermPickerCategory(
			                                                                                                    'characters'
			                                                                                                )
			                                                                                            }
			                                                                                        >
			                                                                                            <UserRound className="h-3.5 w-3.5" />
			                                                                                            {tTerms('categories.characters')}
			                                                                                        </button>
			                                                                                    )}
			                                                                                    {allowed.locations && (
			                                                                                        <button
			                                                                                            type="button"
			                                                                                            className={cn(
			                                                                                                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
			                                                                                                effectiveFilter ===
			                                                                                                    'locations'
			                                                                                                    ? 'bg-foreground text-background'
			                                                                                                    : 'bg-muted/20 text-foreground hover:bg-muted/40'
			                                                                                            )}
			                                                                                            onClick={() =>
			                                                                                                setTermPickerCategory(
			                                                                                                    'locations'
			                                                                                                )
			                                                                                            }
			                                                                                        >
			                                                                                            <MapPin className="h-3.5 w-3.5" />
			                                                                                            {tTerms('categories.locations')}
			                                                                                        </button>
			                                                                                    )}
			                                                                                    {allowed.items && (
			                                                                                        <button
			                                                                                            type="button"
			                                                                                            className={cn(
			                                                                                                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
			                                                                                                effectiveFilter ===
			                                                                                                    'items'
			                                                                                                    ? 'bg-foreground text-background'
			                                                                                                    : 'bg-muted/20 text-foreground hover:bg-muted/40'
			                                                                                            )}
			                                                                                            onClick={() =>
			                                                                                                setTermPickerCategory(
			                                                                                                    'items'
			                                                                                                )
			                                                                                            }
			                                                                                        >
			                                                                                            <Shapes className="h-3.5 w-3.5" />
			                                                                                            {tTerms('categories.items')}
			                                                                                        </button>
			                                                                                    )}
			                                                                                    {allowed.lore && (
			                                                                                        <button
			                                                                                            type="button"
                                                                                            className={cn(
                                                                                                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                                                                                                effectiveFilter ===
                                                                                                    'lore'
                                                                                                    ? 'bg-foreground text-background'
                                                                                                    : 'bg-muted/20 text-foreground hover:bg-muted/40'
                                                                                            )}
			                                                                                            onClick={() =>
			                                                                                                setTermPickerCategory(
			                                                                                                    'lore'
			                                                                                                )
			                                                                                            }
			                                                                                        >
			                                                                                            <BookText className="h-3.5 w-3.5" />
			                                                                                            {tTerms('categories.lore')}
			                                                                                        </button>
			                                                                                    )}
			                                                                                    {allowed.others && (
			                                                                                        <button
			                                                                                            type="button"
			                                                                                            className={cn(
			                                                                                                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
			                                                                                                effectiveFilter ===
			                                                                                                    'others'
			                                                                                                    ? 'bg-foreground text-background'
			                                                                                                    : 'bg-muted/20 text-foreground hover:bg-muted/40'
			                                                                                            )}
			                                                                                            onClick={() =>
			                                                                                                setTermPickerCategory(
			                                                                                                    'others'
			                                                                                                )
			                                                                                            }
			                                                                                        >
			                                                                                            <MoreHorizontal className="h-3.5 w-3.5" />
			                                                                                            {t('advanced.contentSelection.termOtherTypes')}
			                                                                                        </button>
			                                                                                    )}
			                                                                                </div>
			                                                                            )
			                                                                        })()}
			                                                                    </div>

			                                                                    <DropdownMenuSeparator />

			                                                                    <ScrollArea className="h-[360px]">
			                                                                        {(() => {
			                                                                            const allowed = enabled.term.allowedTypes
			                                                                            const effectiveFilter: TermPickerCategoryFilter =
			                                                                                (() => {
			                                                                                    if (termPickerCategory === 'all') return 'all'
			                                                                                    if (
			                                                                                        termPickerCategory ===
			                                                                                        'characters'
			                                                                                    )
			                                                                                        return allowed.characters
			                                                                                            ? termPickerCategory
			                                                                                            : 'all'
			                                                                                    if (termPickerCategory === 'locations')
			                                                                                        return allowed.locations
			                                                                                            ? termPickerCategory
			                                                                                            : 'all'
			                                                                                    if (termPickerCategory === 'items')
			                                                                                        return allowed.items
			                                                                                            ? termPickerCategory
			                                                                                            : 'all'
			                                                                                    if (termPickerCategory === 'lore')
			                                                                                        return allowed.lore
			                                                                                            ? termPickerCategory
			                                                                                            : 'all'
			                                                                                    if (termPickerCategory === 'others')
			                                                                                        return allowed.others
			                                                                                            ? termPickerCategory
			                                                                                            : 'all'
			                                                                                    return 'all'
			                                                                                })()

			                                                                            const items = termPickerItems.filter((entry) => {
			                                                                                const categoryId = entry.categoryId as string
			                                                                                const isAllowed =
			                                                                                    categoryId === 'characters'
			                                                                                        ? allowed.characters
			                                                                                        : categoryId === 'locations'
			                                                                                            ? allowed.locations
			                                                                                            : categoryId === 'items'
			                                                                                                ? allowed.items
			                                                                                                : categoryId === 'lore'
			                                                                                                    ? allowed.lore
			                                                                                                    : allowed.others
			                                                                                if (!isAllowed) return false
			                                                                                if (effectiveFilter === 'all') return true
			                                                                                if (effectiveFilter === 'others')
			                                                                                    return !isDefaultTermCategoryId(
			                                                                                        categoryId
			                                                                                    )
			                                                                                return categoryId === effectiveFilter
			                                                                            })

			                                                                            return (
			                                                                                <div className="p-1 space-y-1">
			                                                                                    {items.length === 0 ? (
			                                                                                        <div className="px-2 py-6 text-sm text-muted-foreground text-center">
			                                                                                            {t(
			                                                                                                'advanced.contentSelection.termPicker.empty'
			                                                                                            )}
			                                                                                        </div>
			                                                                                    ) : (
			                                                                                        items.map((entry) => {
			                                                                                            const target: ContentSelectionTarget =
			                                                                                                {
			                                                                                                    kind: 'term',
			                                                                                                    termId: entry.id,
			                                                                                                }
			                                                                                            const key = selectionKey(target)
			                                                                                            const title =
			                                                                                                entry.title?.trim() ||
			                                                                                                entry.id.slice(0, 8)

			                                                                                            const colorId =
			                                                                                                getTermEntryColorId(
			                                                                                                    entry.color
			                                                                                                )
			                                                                                            const colorClasses =
			                                                                                                getTermEntryColorClasses(
			                                                                                                    colorId
			                                                                                                )
			                                                                                            const hasCustomColor =
			                                                                                                colorId !== 'black'

			                                                                                            if (!allowMultiple) {
			                                                                                                return (
			                                                                                                    <DropdownMenuItem
			                                                                                                        key={key}
			                                                                                                        onSelect={() =>
			                                                                                                            selectSingle(
			                                                                                                                target
			                                                                                                            )
			                                                                                                        }
			                                                                                                    >
			                                                                                                        <span className="flex items-center gap-2 min-w-0">
			                                                                                                            <span
			                                                                                                                className={cn(
			                                                                                                                    'h-2 w-2 rounded-full',
			                                                                                                                    colorClasses.dot
			                                                                                                                )}
			                                                                                                                aria-hidden="true"
			                                                                                                            />
			                                                                                                            <span
			                                                                                                                className={cn(
			                                                                                                                    'truncate',
			                                                                                                                    hasCustomColor &&
			                                                                                                                        colorClasses.text
			                                                                                                                )}
			                                                                                                            >
			                                                                                                                {title}
			                                                                                                            </span>
			                                                                                                        </span>
			                                                                                                    </DropdownMenuItem>
			                                                                                                )
			                                                                                            }

			                                                                                            return (
			                                                                                                <DropdownMenuCheckboxItem
			                                                                                                    key={key}
			                                                                                                    checked={selectedKeys.has(
			                                                                                                        key
			                                                                                                    )}
			                                                                                                    onSelect={(e) =>
			                                                                                                        e.preventDefault()
			                                                                                                    }
			                                                                                                    onCheckedChange={(
			                                                                                                        next
			                                                                                                    ) =>
			                                                                                                        addOrRemove(
			                                                                                                            target,
			                                                                                                            Boolean(
			                                                                                                                next
			                                                                                                            )
			                                                                                                        )
			                                                                                                    }
			                                                                                                >
			                                                                                                    <span className="flex items-center gap-2 min-w-0">
			                                                                                                        <span
			                                                                                                            className={cn(
			                                                                                                                'h-2 w-2 rounded-full',
			                                                                                                                colorClasses.dot
			                                                                                                            )}
			                                                                                                            aria-hidden="true"
			                                                                                                        />
			                                                                                                        <span
			                                                                                                            className={cn(
			                                                                                                                'truncate',
			                                                                                                                hasCustomColor &&
			                                                                                                                    colorClasses.text
			                                                                                                            )}
			                                                                                                        >
			                                                                                                            {title}
			                                                                                                        </span>
			                                                                                                    </span>
			                                                                                                </DropdownMenuCheckboxItem>
			                                                                                            )
			                                                                                        })
			                                                                                    )}
			                                                                                </div>
			                                                                            )
			                                                                        })()}
			                                                                    </ScrollArea>

			                                                                    <DropdownMenuSeparator />
			                                                                    <DropdownMenuItem
			                                                                        disabled={state.selections.length === 0}
			                                                                        onSelect={(e) => {
			                                                                            e.preventDefault()
			                                                                            clearSelections()
			                                                                        }}
			                                                                    >
			                                                                        <Ban className="h-4 w-4" />
			                                                                        {t('advanced.preview.clearSelection')}
			                                                                    </DropdownMenuItem>
			                                                                </DropdownMenuSubContent>
			                                                            </DropdownMenuSub>
			                                                        </>
			                                                    )}
        </>
    )
}
