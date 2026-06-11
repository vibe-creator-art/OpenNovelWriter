'use client'

import type { ContentSelectionTarget } from '@/lib/prompt-inputs'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    DropdownMenuCheckboxItem,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { Ban, Search } from 'lucide-react'
import { getChapterDisplayLabel, selectionKey } from '@/components/editor/prompt-inputs-editor/utils'
import type { PreviewContentSelectionSectionProps } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'

export function PreviewContentSelectionOutlineSection({
    model,
    controller,
}: PreviewContentSelectionSectionProps) {
    const {
        t,
        chapterTitleSeparator,
        ensureOutlinesLoaded,
        novelId,
        outlinePickerError,
        outlinePickerItems,
        outlinePickerLoading,
        outlinePickerQuery,
        setOutlinePickerQuery,
        sortedActs,
        sortedChapters,
    } = model
    const { allowMultiple, enabled, state, selectedKeys, addOrRemove, selectSingle, clearSelections } = controller

    return (
        <>
			                                                    {enabled.outline.enabled && (
			                                                        <>
			                                                            <DropdownMenuSeparator />
			                                                            <DropdownMenuSub
			                                                                onOpenChange={(open) => {
			                                                                    if (!open) return
			                                                                    void ensureOutlinesLoaded()
			                                                                    setOutlinePickerQuery('')
			                                                                }}
				                                                            >
				                                                                <DropdownMenuSubTrigger disabled={!novelId}>
				                                                                    {t('advanced.contentSelection.outline')}
				                                                                </DropdownMenuSubTrigger>
			                                                                <DropdownMenuSubContent className="min-w-[320px]">
			                                                                    <div className="p-2">
			                                                                        <div className="relative">
			                                                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
			                                                                            <Input
			                                                                                value={outlinePickerQuery}
			                                                                                onChange={(e) =>
			                                                                                    setOutlinePickerQuery(e.target.value)
			                                                                                }
			                                                                                onKeyDown={(e) => e.stopPropagation()}
			                                                                                placeholder={t(
			                                                                                    'advanced.contentSelection.outlinePicker.searchPlaceholder'
			                                                                                )}
			                                                                                className="pl-8 h-8 text-sm"
			                                                                            />
			                                                                        </div>
			                                                                    </div>

			                                                                    <DropdownMenuSeparator />

			                                                                    <ScrollArea className="h-[360px]">
			                                                                        <div className="p-1 space-y-1">
			                                                                            {outlinePickerLoading ? (
			                                                                                <div className="px-2 py-6 text-sm text-muted-foreground text-center">
			                                                                                    {t(
			                                                                                        'advanced.contentSelection.outlinePicker.loading'
			                                                                                    )}
			                                                                                </div>
			                                                                            ) : outlinePickerError ? (
			                                                                                <div className="px-2 py-6 text-sm text-destructive text-center">
			                                                                                    {outlinePickerError}
			                                                                                </div>
			                                                                            ) : (() => {
			                                                                                const allowedActs = enabled.outline.act.enabled
			                                                                                const allowedChapters = enabled.outline.chapter.enabled
			                                                                                const items = outlinePickerItems.filter((outline) => {
			                                                                                    if (outline.type === 'ACT') return allowedActs
			                                                                                    if (outline.type === 'CHAPTER') return allowedChapters
			                                                                                    return false
			                                                                                })
			                                                                                if (items.length === 0) {
			                                                                                    return (
			                                                                                        <div className="px-2 py-6 text-sm text-muted-foreground text-center">
			                                                                                            {t(
			                                                                                                'advanced.contentSelection.outlinePicker.empty'
			                                                                                            )}
			                                                                                        </div>
			                                                                                    )
			                                                                                }

			                                                                                const actOutlines = items.filter((outline) => outline.type === 'ACT')
			                                                                                const chapterOutlines = items.filter(
			                                                                                    (outline) => outline.type === 'CHAPTER'
			                                                                                )

			                                                                                return (
			                                                                                    <>
			                                                                                        {actOutlines.length > 0 && (
			                                                                                            <>
			                                                                                                <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
			                                                                                                    {t('advanced.contentSelection.actOutline')}
			                                                                                                </DropdownMenuLabel>
			                                                                                                {actOutlines.map((outline) => {
			                                                                                                    const actNumber = outline.actNumber
			                                                                                                    if (actNumber == null) return null
			                                                                                                    const target: ContentSelectionTarget = {
			                                                                                                        kind: 'act_outline',
			                                                                                                        actNumber,
			                                                                                                    }
			                                                                                                    const key = selectionKey(target)
			                                                                                                    const act = sortedActs.find((a) => a.number === actNumber) ?? null
			                                                                                                    const base = t('advanced.contentSelection.actLabel', { number: actNumber })
			                                                                                                    const label = act?.title?.trim()
			                                                                                                        ? `${base}: ${act.title.trim()}`
			                                                                                                        : base
			                                                                                                    const labelNode = (
			                                                                                                        <div className="min-w-0 flex-1">
			                                                                                                            <div className="truncate text-sm font-medium">
			                                                                                                                {label}
			                                                                                                            </div>
			                                                                                                        </div>
			                                                                                                    )

			                                                                                                    if (!allowMultiple) {
			                                                                                                        return (
			                                                                                                            <DropdownMenuItem
			                                                                                                                key={key}
			                                                                                                                className="items-start py-2"
			                                                                                                                onSelect={() => selectSingle(target)}
			                                                                                                            >
			                                                                                                                {labelNode}
			                                                                                                            </DropdownMenuItem>
			                                                                                                        )
			                                                                                                    }

			                                                                                                    return (
			                                                                                                        <DropdownMenuCheckboxItem
			                                                                                                            key={key}
			                                                                                                            className="items-start py-2"
			                                                                                                            checked={selectedKeys.has(key)}
			                                                                                                            onSelect={(e) => e.preventDefault()}
			                                                                                                            onCheckedChange={(next) =>
			                                                                                                                addOrRemove(target, Boolean(next))
			                                                                                                            }
			                                                                                                        >
			                                                                                                            {labelNode}
			                                                                                                        </DropdownMenuCheckboxItem>
			                                                                                                    )
			                                                                                                })}
			                                                                                            </>
			                                                                                        )}

			                                                                                        {chapterOutlines.length > 0 && (
			                                                                                            <>
			                                                                                                {actOutlines.length > 0 && (
			                                                                                                    <DropdownMenuSeparator />
			                                                                                                )}
			                                                                                                <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
			                                                                                                    {t(
			                                                                                                        'advanced.contentSelection.chapterOutline'
			                                                                                                    )}
			                                                                                                </DropdownMenuLabel>
			                                                                                                {chapterOutlines.map((outline) => {
			                                                                                                    const chapterId = outline.chapterId
			                                                                                                    if (!chapterId) return null
			                                                                                                    const target: ContentSelectionTarget = {
			                                                                                                        kind: 'chapter_outline',
			                                                                                                        chapterId,
			                                                                                                    }
			                                                                                                    const key = selectionKey(target)
			                                                                                                    const chapter =
			                                                                                                        sortedChapters.find((c) => c.id === chapterId) ?? null
			                                                                                                    const label = (() => {
			                                                                                                        if (!chapter) {
			                                                                                                            return `${t(
			                                                                                                                'advanced.contentSelection.chapter'
			                                                                                                            )} (${chapterId.slice(0, 8)})`
			                                                                                                        }
			                                                                                                        const base = t(
			                                                                                                            'advanced.contentSelection.chapterLabel',
			                                                                                                            { number: chapter.displayNumber }
			                                                                                                        )
			                                                                                                        return getChapterDisplayLabel({
			                                                                                                            title: chapter.title,
			                                                                                                            displayNumber: chapter.displayNumber,
			                                                                                                            labelBase: base,
			                                                                                                            chapterWord: t(
			                                                                                                                'advanced.contentSelection.chapter'
			                                                                                                            ),
			                                                                                                            separator: chapterTitleSeparator,
			                                                                                                        })
			                                                                                                    })()
			                                                                                                    const labelNode = (
			                                                                                                        <div className="min-w-0 flex-1">
			                                                                                                            <div className="truncate text-sm font-medium">
			                                                                                                                {label}
			                                                                                                            </div>
			                                                                                                        </div>
			                                                                                                    )

			                                                                                                    if (!allowMultiple) {
			                                                                                                        return (
			                                                                                                            <DropdownMenuItem
			                                                                                                                key={key}
			                                                                                                                className="items-start py-2"
			                                                                                                                onSelect={() => selectSingle(target)}
			                                                                                                            >
			                                                                                                                {labelNode}
			                                                                                                            </DropdownMenuItem>
			                                                                                                        )
			                                                                                                    }

			                                                                                                    return (
			                                                                                                        <DropdownMenuCheckboxItem
			                                                                                                            key={key}
			                                                                                                            className="items-start py-2"
			                                                                                                            checked={selectedKeys.has(key)}
			                                                                                                            onSelect={(e) => e.preventDefault()}
			                                                                                                            onCheckedChange={(next) =>
			                                                                                                                addOrRemove(target, Boolean(next))
			                                                                                                            }
			                                                                                                        >
			                                                                                                            {labelNode}
			                                                                                                        </DropdownMenuCheckboxItem>
			                                                                                                    )
			                                                                                                })}
			                                                                                            </>
			                                                                                        )}
			                                                                                    </>
			                                                                                )
			                                                                            })()}
			                                                                        </div>
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
