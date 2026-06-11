'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookText, Check, ImagePlus, MapPin, MoreHorizontal, Search, Shapes, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { termsApi } from '@/lib/api'
import { useStoredTermEntries } from '@/components/editor/terms/use-stored-term-entries'
import { applyTermGalleryUpdate } from '@/components/editor/terms/term-entries-store'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import type { DefaultTermCategoryId, TermEntry } from '@/components/editor/terms/types'

type CategoryFilter = 'all' | DefaultTermCategoryId | 'others'

const DEFAULT_CATEGORY_FILTERS: { id: DefaultTermCategoryId; icon: typeof UserRound }[] = [
    { id: 'characters', icon: UserRound },
    { id: 'locations', icon: MapPin },
    { id: 'items', icon: Shapes },
    { id: 'lore', icon: BookText },
]

const DEFAULT_CATEGORY_ID_SET = new Set<string>(DEFAULT_CATEGORY_FILTERS.map((filter) => filter.id))

function matchesQuery(entry: TermEntry, query: string) {
    if (!query) return true
    const haystack = [entry.title, entry.subtitle, entry.aliases]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
    return haystack.includes(query)
}

/**
 * "Import to term gallery" viewer action: picks a term via a flyout
 * (search + category chips + list, mirroring the content-selection term
 * picker) and appends the viewed image to that term's gallery server-side.
 */
export function TermGalleryImportButton({ novelId, src }: { novelId?: string; src: string }) {
    const t = useTranslations('editor.terms.gallery')
    const tCategories = useTranslations('editor.terms.categories')
    const entries = useStoredTermEntries(novelId)
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<CategoryFilter>('all')
    const [status, setStatus] = useState<'idle' | 'done' | 'error'>('idle')

    const activeEntries = useMemo(() => entries.filter((entry) => !entry.archived), [entries])
    const hasOthers = useMemo(
        () => activeEntries.some((entry) => !DEFAULT_CATEGORY_ID_SET.has(entry.categoryId)),
        [activeEntries]
    )
    const normalizedQuery = query.trim().toLowerCase()
    const visibleEntries = useMemo(
        () =>
            activeEntries.filter((entry) => {
                if (filter === 'others' && DEFAULT_CATEGORY_ID_SET.has(entry.categoryId)) return false
                if (filter !== 'all' && filter !== 'others' && entry.categoryId !== filter) return false
                return matchesQuery(entry, normalizedQuery)
            }),
        [activeEntries, filter, normalizedQuery]
    )

    // Only persistent URLs survive outside the current session — blob:/data:
    // previews from the composer cannot be imported.
    if (!novelId || !(src.startsWith('/uploads/') || src.startsWith('http://') || src.startsWith('https://'))) {
        return null
    }

    const handleSelect = async (entry: TermEntry) => {
        try {
            const response = await termsApi.addGalleryImage(novelId, entry.id, src)
            applyTermGalleryUpdate({ novelId, entryId: entry.id, gallery: response.gallery })
            setStatus('done')
        } catch (error) {
            console.error('Failed to import image to term gallery:', error)
            setStatus('error')
        }
        setTimeout(() => setStatus('idle'), 1500)
    }

    return (
        <DropdownMenu
            // Default (modal) mode matters here: the viewer Dialog's scroll
            // lock swallows wheel events on portaled content, and only a modal
            // dropdown registers its own content as scrollable with the lock.
            onOpenChange={(open) => {
                if (!open) return
                setQuery('')
                setFilter('all')
            }}
        >
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className={cn(status === 'error' && 'text-destructive')}>
                    {status === 'done' ? <Check className="mr-2 h-4 w-4" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                    {status === 'done' ? t('imported') : status === 'error' ? t('importFailed') : t('importButton')}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="min-w-[320px]">
                <div className="p-2 space-y-2">
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder={t('searchPlaceholder')}
                            className="pl-8 h-8 text-sm"
                        />
                    </div>

                    <div className="flex flex-wrap gap-1">
                        <button
                            type="button"
                            className={cn(
                                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                                filter === 'all'
                                    ? 'bg-foreground text-background'
                                    : 'bg-muted/20 text-foreground hover:bg-muted/40'
                            )}
                            onClick={() => setFilter('all')}
                        >
                            {t('filterAll')}
                        </button>
                        {DEFAULT_CATEGORY_FILTERS.map(({ id, icon: Icon }) => (
                            <button
                                key={id}
                                type="button"
                                className={cn(
                                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                                    filter === id
                                        ? 'bg-foreground text-background'
                                        : 'bg-muted/20 text-foreground hover:bg-muted/40'
                                )}
                                onClick={() => setFilter(id)}
                            >
                                <Icon className="h-3.5 w-3.5" />
                                {tCategories(id)}
                            </button>
                        ))}
                        {hasOthers && (
                            <button
                                type="button"
                                className={cn(
                                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                                    filter === 'others'
                                        ? 'bg-foreground text-background'
                                        : 'bg-muted/20 text-foreground hover:bg-muted/40'
                                )}
                                onClick={() => setFilter('others')}
                            >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                                {t('filterOthers')}
                            </button>
                        )}
                    </div>
                </div>

                <DropdownMenuSeparator />

                <ScrollArea className="h-[280px]">
                    <div className="p-1 space-y-1">
                        {visibleEntries.length === 0 ? (
                            <div className="px-2 py-6 text-sm text-muted-foreground text-center">{t('empty')}</div>
                        ) : (
                            visibleEntries.map((entry) => {
                                const colorId = getTermEntryColorId(entry.color)
                                const colorClasses = getTermEntryColorClasses(colorId)
                                const alreadyImported = entry.gallery?.some((item) => item.url === src) ?? false
                                return (
                                    <DropdownMenuItem key={entry.id} onSelect={() => void handleSelect(entry)}>
                                        <span className="flex w-full items-center gap-2 min-w-0">
                                            <span className={cn('h-2 w-2 rounded-full', colorClasses.dot)} aria-hidden="true" />
                                            <span className={cn('truncate', colorId !== 'black' && colorClasses.text)}>
                                                {entry.title?.trim() || entry.id.slice(0, 8)}
                                            </span>
                                            {alreadyImported && <Check className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
                                        </span>
                                    </DropdownMenuItem>
                                )
                            })
                        )}
                    </div>
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
