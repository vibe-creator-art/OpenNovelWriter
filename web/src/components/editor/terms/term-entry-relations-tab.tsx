import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { ArrowLeftRight, Plus, Repeat2, Trash2 } from 'lucide-react'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import type { TermCategoryView, TermEntry, TermEntryRelation, TermEntryRelationDirection } from '@/components/editor/terms/types'
import { renderIconSpec } from '@/components/editor/terms/utils'
import { CroppedImage } from '@/components/image/cropped-image'
import { parseImageCrop } from '@/lib/image-crop'

type TermEntryRelationsTabProps = {
    entry: TermEntry
    entries: TermEntry[]
    categories: TermCategoryView[]
    onAddRelation: (otherEntryId: string) => void
    onUpdateRelation: (relationId: string, patch: Partial<Pick<TermEntryRelation, 'direction' | 'label'>>) => void
    onDeleteRelation: (relationId: string) => void
    onNavigateToEntry: (entryId: string) => void
}

function invertDirection(direction: TermEntryRelationDirection): TermEntryRelationDirection {
    if (direction === 'outgoing') return 'incoming'
    if (direction === 'incoming') return 'outgoing'
    return 'bidirectional'
}

function toggleBidirectional(direction: TermEntryRelationDirection): TermEntryRelationDirection {
    return direction === 'bidirectional' ? 'outgoing' : 'bidirectional'
}

function RelationArrow({ direction }: { direction: TermEntryRelationDirection }) {
    const left = direction === 'incoming' || direction === 'bidirectional'
    const right = direction === 'outgoing' || direction === 'bidirectional'
    const lineLeft = left ? 14 : 8
    const lineRight = right ? 86 : 92

    return (
        <svg viewBox="0 0 100 10" className="w-full h-4 text-muted-foreground" aria-hidden="true">
            <line
                x1={lineLeft}
                y1={5}
                x2={lineRight}
                y2={5}
                stroke="currentColor"
                strokeWidth={2.25}
                strokeLinecap="round"
            />
            {right && (
                <polyline
                    points="86,2 92,5 86,8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}
            {left && (
                <polyline
                    points="14,2 8,5 14,8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}
        </svg>
    )
}

function EntryMini({
    entry,
    fallbackCategory,
}: {
    entry: TermEntry
    fallbackCategory: TermCategoryView | null
}) {
    const colorId = getTermEntryColorId(entry.color)
    const classes = getTermEntryColorClasses(colorId)
    const titleAccent = colorId !== 'black'
    const iconAccent = !entry.avatar && titleAccent

    const fallbackIcon = fallbackCategory?.icon ?? { type: 'lucide', name: 'shapes' }

    return (
        <div className="flex items-center gap-2 min-w-0">
            <span
                className={cn(
                    'h-7 w-7 shrink-0 rounded-full border overflow-hidden flex items-center justify-center',
                    entry.avatar ? 'bg-background text-muted-foreground' : iconAccent ? `${classes.subtleBg} ${classes.subtleBorder}` : 'bg-background text-muted-foreground'
                )}
            >
                {entry.avatar ? (
                    <CroppedImage src={entry.avatar} crop={parseImageCrop(entry.avatarCrop)} aspectRatio={1} className="h-full w-full" />
                ) : (
                    <span className="[&_svg]:h-4 [&_svg]:w-4">
                        {renderIconSpec(fallbackIcon, cn('h-4 w-4', iconAccent ? classes.icon : 'text-muted-foreground'))}
                    </span>
                )}
            </span>
            <span className={cn('truncate font-medium', titleAccent && classes.text)}>{entry.title}</span>
        </div>
    )
}

function RelationRow({
    relation,
    leftEntry,
    rightEntry,
    leftCategory,
    rightCategory,
    onNavigate,
    onUpdate,
    onDelete,
}: {
    relation: TermEntryRelation
    leftEntry: TermEntry
    rightEntry: TermEntry
    leftCategory: TermCategoryView | null
    rightCategory: TermCategoryView | null
    onNavigate: () => void
    onUpdate: (patch: Partial<Pick<TermEntryRelation, 'direction' | 'label'>>) => void
    onDelete: () => void
}) {
    const t = useTranslations('editor')
    const [draft, setDraft] = useState(relation.label ?? '')

    const commit = () => {
        const next = draft.trim()
        const current = (relation.label ?? '').trim()
        if (next === current) return
        onUpdate({ label: next })
    }

    return (
        <div
            className={cn(
                'group grid items-center gap-2 rounded-lg border bg-card px-2 py-2',
                // Give the entries more room on narrow panels by shrinking the arrow segment first.
                'grid-cols-[minmax(0,1fr)_minmax(96px,140px)_minmax(0,1fr)_auto]',
                'hover:bg-muted/25 transition-colors cursor-pointer'
            )}
            role="button"
            tabIndex={0}
            onClick={onNavigate}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onNavigate()
            }}
        >
            <EntryMini entry={leftEntry} fallbackCategory={leftCategory} />

            <div className="relative flex items-center justify-center h-9">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-1">
                    <RelationArrow direction={relation.direction} />
                </div>
                <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit()}
                    onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        ;(e.target as HTMLInputElement).blur()
                    }}
                    placeholder={t('terms.panel.relations.labelPlaceholder')}
                    className={cn(
                        'relative z-10 h-7 w-20 px-2 text-center text-sm',
                        'bg-background/90 hover:bg-background focus-visible:bg-background'
                    )}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                />
            </div>

            <EntryMini entry={rightEntry} fallbackCategory={rightCategory} />

            <div className="flex items-center gap-1 shrink-0">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn('h-6 w-6', relation.direction === 'bidirectional' && 'bg-muted')}
                    title={t('terms.panel.relations.actions.bidirectional')}
                    aria-label={t('terms.panel.relations.actions.bidirectional')}
                    onClick={(e) => {
                        e.stopPropagation()
                        onUpdate({ direction: toggleBidirectional(relation.direction) })
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                </Button>

                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-6 w-6"
                    title={t('terms.panel.relations.actions.reverse')}
                    aria-label={t('terms.panel.relations.actions.reverse')}
                    disabled={relation.direction === 'bidirectional'}
                    onClick={(e) => {
                        e.stopPropagation()
                        if (relation.direction === 'bidirectional') return
                        onUpdate({ direction: invertDirection(relation.direction) })
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <Repeat2 className="h-3.5 w-3.5" />
                </Button>

                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    title={t('terms.panel.relations.actions.delete')}
                    aria-label={t('terms.panel.relations.actions.delete')}
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete()
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    )
}

export function TermEntryRelationsTab({
    entry,
    entries,
    categories,
    onAddRelation,
    onUpdateRelation,
    onDeleteRelation,
    onNavigateToEntry,
}: TermEntryRelationsTabProps) {
    const t = useTranslations('editor')

    const categoryById = useMemo(() => {
        const map = new Map<string, TermCategoryView>()
        for (const c of categories) map.set(c.id, c)
        return map
    }, [categories])

    const entryById = useMemo(() => {
        const map = new Map<string, TermEntry>()
        for (const e of entries) map.set(e.id, e)
        return map
    }, [entries])

    const relations = useMemo(() => {
        const list = (entry.relations ?? []).filter((rel) => rel.otherId && rel.otherId !== entry.id)
        return list
            .slice()
            .sort((a, b) => {
                const aTitle = entryById.get(a.otherId)?.title ?? ''
                const bTitle = entryById.get(b.otherId)?.title ?? ''
                return aTitle.localeCompare(bTitle)
            })
    }, [entry.id, entry.relations, entryById])

    const existingOtherIdSet = useMemo(() => new Set(relations.map((rel) => rel.otherId)), [relations])

    const [addOpen, setAddOpen] = useState(false)
    const [query, setQuery] = useState('')
    const normalizedQuery = query.trim().toLocaleLowerCase()

    const candidates = useMemo(() => {
        const list = entries.filter((e) => !e.archived && e.id !== entry.id && !existingOtherIdSet.has(e.id))
        if (!normalizedQuery) return list.sort((a, b) => a.title.localeCompare(b.title))
        return list
            .filter((e) => `${e.title} ${e.subtitle ?? ''}`.toLocaleLowerCase().includes(normalizedQuery))
            .sort((a, b) => a.title.localeCompare(b.title))
    }, [entries, entry.id, existingOtherIdSet, normalizedQuery])

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                    <div className="text-sm font-semibold">{t('terms.panel.relations.title')}</div>
                    <div className="text-xs text-muted-foreground">{t('terms.panel.relations.help')}</div>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t('terms.panel.relations.add')}
                </Button>
            </div>

            {relations.length === 0 ? (
                <div className="rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground">{t('terms.panel.relations.empty')}</div>
            ) : (
                <div className="space-y-2">
                    {relations.map((rel) => {
                        const other = entryById.get(rel.otherId) ?? null
                        if (!other) return null
                        return (
                            <RelationRow
                                key={rel.id}
                                relation={rel}
                                leftEntry={entry}
                                rightEntry={other}
                                leftCategory={categoryById.get(entry.categoryId) ?? null}
                                rightCategory={categoryById.get(other.categoryId) ?? null}
                                onNavigate={() => onNavigateToEntry(other.id)}
                                onUpdate={(patch) => onUpdateRelation(rel.id, patch)}
                                onDelete={() => onDeleteRelation(rel.id)}
                            />
                        )
                    })}
                </div>
            )}

            <Dialog
                open={addOpen}
                onOpenChange={(open) => {
                    setAddOpen(open)
                    if (!open) setQuery('')
                }}
            >
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{t('terms.panel.relations.picker.title')}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label htmlFor="term-relation-search">{t('terms.panel.relations.picker.searchLabel')}</Label>
                            <Input
                                id="term-relation-search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={t('terms.panel.relations.picker.searchPlaceholder')}
                            />
                        </div>

                        {candidates.length === 0 ? (
                            <div className="rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground">
                                {t('terms.panel.relations.picker.empty')}
                            </div>
                        ) : (
                            <ScrollArea className="h-80 rounded-md border">
                                <div className="p-2 space-y-1">
                                    {candidates.map((candidate) => (
                                        <button
                                            key={candidate.id}
                                            type="button"
                                            className={cn(
                                                'w-full flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                                                'border-transparent hover:bg-muted'
                                            )}
                                            onClick={() => {
                                                onAddRelation(candidate.id)
                                                setAddOpen(false)
                                                setQuery('')
                                            }}
                                        >
                                            <EntryMini
                                                entry={candidate}
                                                fallbackCategory={categoryById.get(candidate.categoryId) ?? null}
                                            />
                                            {candidate.subtitle && (
                                                <span className="ml-auto text-xs text-muted-foreground truncate max-w-[40%]">
                                                    {candidate.subtitle}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </ScrollArea>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
