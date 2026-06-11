'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollBar } from '@/components/ui/scroll-area'
import { CroppedImage } from '@/components/image/cropped-image'
import { parseImageCrop } from '@/lib/image-crop'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import type { CustomCategoryIcon, TermCategoryId, TermEntry, TermEntryColorId } from '@/components/editor/terms/types'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import { renderIconSpec } from '@/components/editor/terms/utils'
import { TermEntryMarkdown } from '@/components/editor/terms/term-entry-markdown'
import { dispatchOpenTermEntry } from '@/components/editor/terms/term-entry-events'
import { useTermEntriesStore } from '@/components/editor/terms/term-entries-store'

type AnchorPosition = { top: number; left: number }

type TermMentionPreviewPopoverProps = {
    novelId?: string
    open: boolean
    anchorEl: HTMLElement | null
    entry: TermEntry | null
    onClose: () => void
}

const DEFAULT_ICON: CustomCategoryIcon = { type: 'lucide', name: 'shapes' }

function getDefaultCategoryView(
    t: (key: string, values?: Record<string, string | number | Date>) => string,
    categoryId: TermCategoryId
) {
    if (categoryId === 'characters') {
        return { label: t('terms.categories.characters'), icon: { type: 'lucide', name: 'user-round' } as const }
    }
    if (categoryId === 'locations') {
        return { label: t('terms.categories.locations'), icon: { type: 'lucide', name: 'map-pin' } as const }
    }
    if (categoryId === 'items') {
        return { label: t('terms.categories.items'), icon: { type: 'lucide', name: 'shapes' } as const }
    }
    if (categoryId === 'lore') {
        return { label: t('terms.categories.lore'), icon: { type: 'lucide', name: 'book-text' } as const }
    }

    if (categoryId === 'preset_skills') {
        return { label: t('terms.presetCategories.items.skills'), icon: { type: 'lucide', name: 'sword' } as const }
    }
    if (categoryId === 'preset_talents') {
        return { label: t('terms.presetCategories.items.talents'), icon: { type: 'lucide', name: 'sparkles' } as const }
    }
    if (categoryId === 'preset_realms') {
        return { label: t('terms.presetCategories.items.realms'), icon: { type: 'lucide', name: 'milestone' } as const }
    }

    return null
}

function getTextAccentColorId(color?: TermEntryColorId) {
    const id = getTermEntryColorId(color)
    return id === 'black' ? null : id
}

export function TermMentionPreviewPopover({ novelId, open, anchorEl, entry, onClose }: TermMentionPreviewPopoverProps) {
    const t = useTranslations('editor')
    const meta = useTermEntriesStore((s) => (novelId ? s.metaByNovelId[novelId] : undefined))

    const popoverRef = useRef<HTMLDivElement | null>(null)
    const [position, setPosition] = useState<AnchorPosition | null>(null)

    const categoryView = useMemo(() => {
        if (!entry) return null
        const fromDefaults = getDefaultCategoryView(t, entry.categoryId)
        if (fromDefaults) return fromDefaults

        const custom = meta?.customCategories?.find((c) => c.id === entry.categoryId) ?? null
        if (custom) {
            return { label: custom.label, icon: custom.icon ?? DEFAULT_ICON }
        }

        return { label: String(entry.categoryId), icon: DEFAULT_ICON }
    }, [entry, meta?.customCategories, t])

    const titleAccentId = useMemo(() => getTextAccentColorId(entry?.color), [entry?.color])
    const titleClasses = useMemo(() => (titleAccentId ? getTermEntryColorClasses(titleAccentId) : null), [titleAccentId])

    const tags = useMemo(() => (entry?.tags ?? []).filter(Boolean), [entry?.tags])
    const updatePosition = useCallback(() => {
        if (!anchorEl || !popoverRef.current) return
        if (!anchorEl.isConnected) {
            onClose()
            return
        }

        const anchorRect = anchorEl.getBoundingClientRect()
        const popoverRect = popoverRef.current.getBoundingClientRect()

        const margin = 8
        let left = anchorRect.left
        let top = anchorRect.bottom + 8

        if (left + popoverRect.width > window.innerWidth - margin) {
            left = window.innerWidth - margin - popoverRect.width
        }
        left = Math.max(margin, left)

        if (top + popoverRect.height > window.innerHeight - margin) {
            const aboveTop = anchorRect.top - 8 - popoverRect.height
            if (aboveTop >= margin) {
                top = aboveTop
            } else {
                top = Math.max(margin, window.innerHeight - margin - popoverRect.height)
            }
        }

        setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }))
    }, [anchorEl, onClose])

    useLayoutEffect(() => {
        if (!open) return
        if (!anchorEl) return
        if (!entry) return
        updatePosition()
    }, [anchorEl, entry, open, updatePosition])

    useEffect(() => {
        if (!open) return

        const onScrollOrResize = () => updatePosition()
        window.addEventListener('resize', onScrollOrResize)
        window.addEventListener('scroll', onScrollOrResize, true)

        const ro = new ResizeObserver(onScrollOrResize)
        if (popoverRef.current) ro.observe(popoverRef.current)

        return () => {
            ro.disconnect()
            window.removeEventListener('resize', onScrollOrResize)
            window.removeEventListener('scroll', onScrollOrResize, true)
        }
    }, [open, updatePosition])

    useEffect(() => {
        if (!open) return

        const onPointerDownCapture = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null
            if (!target) return
            if (popoverRef.current?.contains(target)) return
            if (anchorEl?.contains(target)) return
            onClose()
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }

        document.addEventListener('pointerdown', onPointerDownCapture, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('pointerdown', onPointerDownCapture, true)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [anchorEl, onClose, open])

    if (!open || !anchorEl || !entry || !categoryView) return null

    const fallbackRect = anchorEl.getBoundingClientRect()
    const fallbackPosition: AnchorPosition = {
        top: Math.max(8, fallbackRect.bottom + 8),
        left: Math.max(8, Math.min(fallbackRect.left, window.innerWidth - 8 - 380)),
    }
    const appliedPosition = position ?? fallbackPosition

    return createPortal(
        <div
            ref={popoverRef}
            className="fixed z-[60] w-[380px] max-w-[calc(100vw-16px)]"
            style={{ top: appliedPosition.top, left: appliedPosition.left }}
            role="dialog"
            aria-label={entry.title}
            data-term-floating-panel="true"
        >
            <div className="rounded-xl border bg-card shadow-2xl overflow-hidden">
                <div className="p-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full border bg-background text-muted-foreground">
                                    {renderIconSpec(categoryView.icon ?? DEFAULT_ICON, 'h-4 w-4 rounded-full text-muted-foreground')}
                                </span>
                                <span className="font-medium">{categoryView.label}</span>
                            </div>

                            <div className="mt-2 flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1 space-y-2">
                                    <div className={cn('text-2xl font-semibold leading-none', titleClasses?.text)}>{entry.title}</div>
                                    {tags.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {tags.map((tag) => (
                                                <Badge key={tag} variant="secondary" className="rounded-md">
                                                    {tag}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border">
                                    {entry.avatar ? (
                                        <CroppedImage
                                            src={entry.avatar}
                                            crop={parseImageCrop(entry.avatarCrop)}
                                            aspectRatio={1}
                                            className="h-full w-full"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                            <span className="[&_svg]:h-5 [&_svg]:w-5">
                                                {renderIconSpec(categoryView.icon ?? DEFAULT_ICON, 'h-5 w-5 text-muted-foreground')}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label={t('terms.panel.close')}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <Separator />

                <ScrollAreaPrimitive.Root type="auto" className="max-h-[45vh] overflow-hidden">
                    <ScrollAreaPrimitive.Viewport className="max-h-[45vh] w-full overscroll-contain">
                        <div
                            className={cn(
                                'p-4 pt-3 text-sm',
                                entry.description?.trim() ? 'text-foreground' : 'text-muted-foreground'
                            )}
                        >
                            <TermEntryMarkdown content={entry.description} />
                        </div>
                    </ScrollAreaPrimitive.Viewport>
                    <ScrollBar />
                    <ScrollAreaPrimitive.Corner />
                </ScrollAreaPrimitive.Root>

                <Separator />

                <div className="p-3 flex items-center justify-end gap-2 bg-muted/20">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            dispatchOpenTermEntry({ novelId, entryId: entry.id, tab: 'details' })
                            onClose()
                        }}
                    >
                        {t('terms.panel.mentions.open')}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    )
}
