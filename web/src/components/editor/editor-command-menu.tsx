'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type AnchorPosition = { top: number; left: number }

export type EditorCommandMenuItem = {
    id: string
    section: string
    title: string
    description?: string
    icon?: ReactNode
    disabled?: boolean
}

function groupItems(items: EditorCommandMenuItem[]) {
    const sections: Array<{ section: string; items: EditorCommandMenuItem[] }> = []
    const bySection = new Map<string, EditorCommandMenuItem[]>()
    for (const item of items) {
        const list = bySection.get(item.section) ?? []
        list.push(item)
        bySection.set(item.section, list)
    }
    for (const [section, sectionItems] of bySection.entries()) {
        sections.push({ section, items: sectionItems })
    }
    sections.sort((a, b) => a.section.localeCompare(b.section, undefined, { sensitivity: 'base' }))
    return sections
}

export function EditorCommandMenu({
    open,
    items,
    anchor,
    searchPlaceholder,
    emptyLabel,
    onSelect,
    onClose,
}: {
    open: boolean
    items: EditorCommandMenuItem[]
    anchor: AnchorPosition | null
    searchPlaceholder?: string
    emptyLabel?: string
    onSelect: (id: string) => void
    onClose: () => void
}) {
    const menuRef = useRef<HTMLDivElement | null>(null)
    const searchInputRef = useRef<HTMLInputElement | null>(null)
    const [position, setPosition] = useState<AnchorPosition | null>(null)
    const [query, setQuery] = useState('')
    const handleClose = useCallback(() => {
        setQuery('')
        onClose()
    }, [onClose])

    const filteredItems = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase()
        if (!normalizedQuery) return items

        return items.filter((item) => {
            const haystack = [item.section, item.title, item.description ?? ''].join('\n').toLocaleLowerCase()
            return haystack.includes(normalizedQuery)
        })
    }, [items, query])
    const sections = useMemo(() => groupItems(filteredItems), [filteredItems])
    const firstActiveItem = useMemo(
        () => filteredItems.find((item) => !item.disabled) ?? null,
        [filteredItems]
    )

    const updatePosition = useCallback(() => {
        if (!anchor || !menuRef.current) return
        const rect = menuRef.current.getBoundingClientRect()

        const margin = 8
        let left = anchor.left
        let top = anchor.top

        if (left + rect.width > window.innerWidth - margin) {
            left = window.innerWidth - margin - rect.width
        }
        left = Math.max(margin, left)

        if (top + rect.height > window.innerHeight - margin) {
            const aboveTop = anchor.top - 8 - rect.height
            if (aboveTop >= margin) {
                top = aboveTop
            } else {
                top = Math.max(margin, window.innerHeight - margin - rect.height)
            }
        }

        setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }))
    }, [anchor])

    useLayoutEffect(() => {
        if (!open) return
        if (!anchor) return
        updatePosition()
    }, [anchor, open, query, updatePosition])

    useEffect(() => {
        if (!open) return
        if (!searchPlaceholder) return
        searchInputRef.current?.focus()
    }, [open, searchPlaceholder])

    useEffect(() => {
        if (!open) return
        const onScrollOrResize = () => handleClose()
        window.addEventListener('resize', onScrollOrResize)
        window.addEventListener('scroll', onScrollOrResize, true)
        return () => {
            window.removeEventListener('resize', onScrollOrResize)
            window.removeEventListener('scroll', onScrollOrResize, true)
        }
    }, [handleClose, open])

    useEffect(() => {
        if (!open) return
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null
            if (!target) return
            if (menuRef.current && menuRef.current.contains(target)) return
            handleClose()
        }
        document.addEventListener('mousedown', onPointerDown, true)
        return () => document.removeEventListener('mousedown', onPointerDown, true)
    }, [handleClose, open])

    useEffect(() => {
        if (!open) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            handleClose()
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [handleClose, open])

    const handleSearchKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key !== 'Enter' || !firstActiveItem) return
            event.preventDefault()
            onSelect(firstActiveItem.id)
        },
        [firstActiveItem, onSelect]
    )

    if (!open || !anchor) return null

    const style = position ? { top: position.top, left: position.left } : { top: anchor.top, left: anchor.left }

    return createPortal(
        <div
            ref={menuRef}
            className={cn(
                'fixed z-50 flex w-[22rem] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] flex-col',
                'rounded-xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden'
            )}
            style={style}
            role="dialog"
            aria-label="Editor commands"
            data-editor-command-menu="true"
        >
            {searchPlaceholder && (
                <div className="border-b p-2">
                    <Input
                        ref={searchInputRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder={searchPlaceholder}
                    />
                </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="py-2">
                    {sections.length === 0 ? (
                        <div className="px-3 py-6 text-sm text-muted-foreground">
                            {emptyLabel ?? 'No matching commands.'}
                        </div>
                    ) : (
                        sections.map(({ section, items }, sectionIndex) => (
                            <div key={section}>
                                {sectionIndex > 0 && <div className="my-2 h-px bg-border" />}
                                <div className="px-3 pb-2 text-sm font-semibold text-muted-foreground">{section}</div>
                                <div className="space-y-1 px-2">
                                    {items.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className={cn(
                                                'w-full rounded-lg p-2 text-left transition-colors',
                                                'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                                                item.disabled && 'opacity-50 pointer-events-none'
                                            )}
                                            onClick={() => onSelect(item.id)}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div
                                                    className={cn(
                                                        'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-background'
                                                    )}
                                                    aria-hidden="true"
                                                >
                                                    {item.icon}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold leading-5">{item.title}</div>
                                                    {item.description?.trim() && (
                                                        <div className="text-sm text-muted-foreground leading-5">
                                                            {item.description}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>,
        document.body
    )
}
