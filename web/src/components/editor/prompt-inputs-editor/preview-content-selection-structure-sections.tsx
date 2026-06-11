'use client'

import type { ContentSelectionTarget } from '@/lib/prompt-inputs'
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
import { cn } from '@/lib/utils'
import { Ban } from 'lucide-react'
import { getChapterDisplayLabel } from '@/components/editor/prompt-inputs-editor/utils'
import type { PreviewContentSelectionSectionProps } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'

export function PreviewContentSelectionStructureSections({
    input,
    model,
    controller,
}: PreviewContentSelectionSectionProps) {
    const {
        t,
        chapterCountByActNumber,
        chapterTitleSeparator,
        handleUpdateContentSelectionPreviewState,
        sortedActs,
        sortedChapters,
    } = model
    const {
        allowMultiple,
        enabled,
        selectedKeys,
        hasActSelections,
        hasChapterSelections,
        fullNovelTreatLabel,
        actTreatLabel,
        chapterTreatLabel,
        sceneTreatLabel,
        addOrRemove,
        selectSingle,
    } = controller

    return (
        <>
		                                                        {enabled.fullNovel.enabled && (
		                                                            <DropdownMenuCheckboxItem
		                                                                className={cn(
		                                                                    'pl-2 pr-2 [&>span]:hidden',
		                                                                    'data-[state=checked]:bg-muted/40'
		                                                                )}
		                                                                checked={selectedKeys.has('full_novel')}
		                                                                onSelect={(e) => e.preventDefault()}
		                                                                onCheckedChange={(next) =>
		                                                                    addOrRemove({ kind: 'full_novel' }, Boolean(next))
		                                                                }
		                                                            >
		                                                                <div className="flex items-center justify-between gap-2 w-full">
		                                                                    <span>{t('advanced.contentSelection.fullNovel')}</span>
		                                                                    <span className="text-xs text-muted-foreground">
		                                                                        {fullNovelTreatLabel}
		                                                                    </span>
		                                                                </div>
		                                                            </DropdownMenuCheckboxItem>
		                                                        )}

	                                                    {(enabled.act.enabled || enabled.chapter.enabled || enabled.scene.enabled) && (
	                                                        <DropdownMenuSeparator />
	                                                    )}

		                                                    {enabled.act.enabled && (
		                                                        <DropdownMenuSub>
		                                                            <DropdownMenuSubTrigger disabled={sortedActs.length === 0}>
		                                                                <div className="flex-1 flex items-center justify-between gap-2">
		                                                                    <span>{t('advanced.contentSelection.actPlural')}</span>
		                                                                    <span className="text-xs text-muted-foreground">
		                                                                        {actTreatLabel}
		                                                                    </span>
		                                                                </div>
		                                                            </DropdownMenuSubTrigger>
				                                                            <DropdownMenuSubContent className="min-w-[320px]">
				                                                                <ScrollArea className="h-[360px]">
			                                                                    <div className="p-1">
			                                                                        {sortedActs.map((act) => {
		                                                                            const key = `act:${act.number}`
		                                                                            const labelBase = t('advanced.contentSelection.actLabel', { number: act.number })
		                                                                            const label = act.title?.trim()
	                                                                                ? `${labelBase}: ${act.title.trim()}`
	                                                                                : labelBase
	                                                                            const chapterCount = chapterCountByActNumber.get(act.number) ?? 0
	                                                                            const chapterCountLabel =
	                                                                                chapterCount === 1
	                                                                                    ? t('advanced.contentSelection.chapterCountOne')
	                                                                                    : t('advanced.contentSelection.chapterCountOther', {
	                                                                                          count: chapterCount,
	                                                                                      })
	                                                                            const labelNode = (
	                                                                                <div className="min-w-0 flex-1 space-y-1">
	                                                                                    <div className="truncate text-sm font-medium">
	                                                                                        {label}
	                                                                                    </div>
	                                                                                    <div className="truncate text-xs text-muted-foreground">
	                                                                                        {chapterCountLabel}
	                                                                                    </div>
	                                                                                </div>
	                                                                            )
	                                                                            if (!allowMultiple) {
	                                                                                return (
	                                                                                    <DropdownMenuItem
	                                                                                        key={key}
	                                                                                        className="items-start py-2"
	                                                                                        onSelect={() => selectSingle({ kind: 'act', actNumber: act.number })}
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
	                                                                                        addOrRemove({ kind: 'act', actNumber: act.number }, Boolean(next))
	                                                                                    }
	                                                                                >
	                                                                                    {labelNode}
	                                                                                </DropdownMenuCheckboxItem>
	                                                                            )
			                                                                        })}
			                                                                    </div>
			                                                                </ScrollArea>
				                                                                <DropdownMenuSeparator />
				                                                                <DropdownMenuItem
				                                                                    disabled={!hasActSelections}
				                                                                    onSelect={(e) => {
				                                                                        e.preventDefault()
                                                                        handleUpdateContentSelectionPreviewState(
                                                                            input.id,
                                                                            { selections: [] },
                                                                            (prev) => ({
                                                                                selections: prev.selections.filter(
                                                                                    (selection) => selection.kind !== 'act'
			                                                                                ),
			                                                                            })
			                                                                        )
			                                                                    }}
			                                                                >
			                                                                    <Ban className="h-4 w-4" />
			                                                                    {t('advanced.preview.clearSelection')}
		                                                                </DropdownMenuItem>
			                                                            </DropdownMenuSubContent>
			                                                        </DropdownMenuSub>
		                                                    )}
	
		                                                    {enabled.chapter.enabled && (
		                                                        <DropdownMenuSub>
				                                                        <DropdownMenuSubTrigger disabled={sortedChapters.length === 0}>
				                                                                <div className="flex-1 flex items-center justify-between gap-2">
				                                                                    <span>{t('advanced.contentSelection.chapterPlural')}</span>
				                                                                    <span className="text-xs text-muted-foreground">
				                                                                        {chapterTreatLabel}
				                                                                    </span>
				                                                            </div>
				                                                        </DropdownMenuSubTrigger>
				                                                        <DropdownMenuSubContent className="min-w-[320px]">
				                                                            <ScrollArea className="h-[360px]">
				                                                                <div className="p-1">
				                                                                    {(() => {
				                                                                        const actTitleByNumber = new Map(
				                                                                            sortedActs.map((act) => [act.number, act.title])
				                                                                        )
			                                                                        const actNumbers = [
			                                                                            ...new Set(sortedChapters.map((chapter) => chapter.actNumber)),
			                                                                        ].sort((a, b) => a - b)
				                                                                        return actNumbers.map((actNumber, index) => {
				                                                                            const chaptersInAct = sortedChapters.filter(
				                                                                                (chapter) => chapter.actNumber === actNumber
				                                                                            )
				                                                                            if (chaptersInAct.length === 0) return null
				                                                                            const chapterCountLabel =
				                                                                                chaptersInAct.length === 1
				                                                                                    ? t('advanced.contentSelection.chapterCountOne')
				                                                                                    : t('advanced.contentSelection.chapterCountOther', {
				                                                                                          count: chaptersInAct.length,
				                                                                                      })
				                                                                            const actLabelBase = t('advanced.contentSelection.actLabel', {
				                                                                                number: actNumber,
				                                                                            })
				                                                                            const actTitleRaw = actTitleByNumber.get(actNumber) ?? null
				                                                                            const actTitle = actTitleRaw?.trim() ?? ''
			                                                                            const actLabel = actTitle ? `${actLabelBase}: ${actTitle}` : actLabelBase
			                                                                            return (
				                                                                                <div
				                                                                                    key={`chapters-act-${actNumber}`}
				                                                                                    className="space-y-2"
				                                                                                >
				                                                                                    <DropdownMenuLabel className="flex items-center justify-between gap-2 rounded-sm bg-muted/30 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
				                                                                                        <span className="min-w-0 truncate">
				                                                                                            {actLabel}
				                                                                                        </span>
				                                                                                        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
				                                                                                            {chapterCountLabel}
				                                                                                        </span>
				                                                                                    </DropdownMenuLabel>
				                                                                                    <div className="ml-3 mt-1 border-l border-border/60 pl-3">
					                                                                                        {chaptersInAct.map((chapter) => {
					                                                                                            const key = `chapter:${chapter.id}`
					                                                                                            const labelBase = t(
					                                                                                                'advanced.contentSelection.chapterLabel',
					                                                                                                { number: chapter.displayNumber }
					                                                                                            )
					                                                                                            const label = getChapterDisplayLabel({
					                                                                                                title: chapter.title,
					                                                                                                displayNumber: chapter.displayNumber,
					                                                                                                labelBase,
					                                                                                                chapterWord: t('advanced.contentSelection.chapter'),
					                                                                                                separator: chapterTitleSeparator,
					                                                                                            })
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
				                                                                                                        onSelect={() =>
				                                                                                                            selectSingle({
				                                                                                                                kind: 'chapter',
				                                                                                                                chapterId: chapter.id,
				                                                                                                            })
				                                                                                                        }
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
				                                                                                                        addOrRemove(
				                                                                                                            {
				                                                                                                                kind: 'chapter',
				                                                                                                                chapterId: chapter.id,
				                                                                                                            },
				                                                                                                            Boolean(next)
				                                                                                                        )
				                                                                                                    }
				                                                                                                >
				                                                                                                    {labelNode}
				                                                                                                </DropdownMenuCheckboxItem>
				                                                                                            )
				                                                                                        })}
				                                                                                    </div>
				                                                                                    {index < actNumbers.length - 1 && (
				                                                                                        <DropdownMenuSeparator className="my-2" />
				                                                                                    )}
				                                                                                </div>
				                                                                            )
				                                                                        })
				                                                                    })()}
				                                                                </div>
				                                                            </ScrollArea>
				                                                            <DropdownMenuSeparator />
				                                                            <DropdownMenuItem
				                                                                disabled={!hasChapterSelections}
				                                                                onSelect={(e) => {
				                                                                    e.preventDefault()
                                                                    handleUpdateContentSelectionPreviewState(
                                                                        input.id,
                                                                        { selections: [] },
                                                                        (prev) => ({
                                                                            selections: prev.selections.filter(
                                                                                (selection) => selection.kind !== 'chapter'
				                                                                            ),
				                                                                        })
				                                                                    )
				                                                                }}
				                                                            >
				                                                                <Ban className="h-4 w-4" />
				                                                                {t('advanced.preview.clearSelection')}
			                                                            </DropdownMenuItem>
			                                                            </DropdownMenuSubContent>
			                                                        </DropdownMenuSub>
		                                                    )}
	
		                                                    {enabled.scene.enabled && (
		                                                        <DropdownMenuSub>
		                                                            <DropdownMenuSubTrigger disabled={sortedChapters.length === 0}>
		                                                                <div className="flex-1 flex items-center justify-between gap-2">
		                                                                    <span>{t('advanced.contentSelection.scenePlural')}</span>
		                                                                    <span className="text-xs text-muted-foreground">
		                                                                        {sceneTreatLabel}
		                                                                    </span>
			                                                            </div>
			                                                            </DropdownMenuSubTrigger>
			                                                            <DropdownMenuSubContent className="min-w-[320px]">
			                                                                <ScrollArea className="h-[360px]">
		                                                                    <div className="p-1">
		                                                                        {sortedChapters.map((chapter) => {
			                                                                            const chapterLabelBase = t('advanced.contentSelection.chapterLabel', {
			                                                                                number: chapter.displayNumber,
			                                                                            })
		                                                                            const chapterLabel = getChapterDisplayLabel({
		                                                                                title: chapter.title,
		                                                                                displayNumber: chapter.displayNumber,
		                                                                                labelBase: chapterLabelBase,
		                                                                                chapterWord: t('advanced.contentSelection.chapter'),
		                                                                                separator: chapterTitleSeparator,
		                                                                            })
		                                                                            return (
		                                                                                <div key={chapter.id} className="space-y-1">
		                                                                                    <DropdownMenuLabel className="text-xs text-muted-foreground">
		                                                                                        {chapterLabel}
	                                                                                    </DropdownMenuLabel>
	                                                                                    {chapter.scenes.length === 0 ? (
	                                                                                        <DropdownMenuItem disabled>
	                                                                                            {t('advanced.contentSelection.noScenes')}
	                                                                                        </DropdownMenuItem>
		                                                                                    ) : (
		                                                                                        chapter.scenes.map((scene, index) => {
		                                                                                            const target: ContentSelectionTarget = {
		                                                                                                kind: 'scene',
	                                                                                                sceneId: scene.id,
	                                                                                            }
	                                                                                            const key = `scene:${scene.id}`
	                                                                                            const label = t('advanced.contentSelection.sceneLabel', {
	                                                                                                number: index + 1,
	                                                                                            })
		                                                                                            if (!allowMultiple) {
		                                                                                                return (
		                                                                                                    <DropdownMenuItem
		                                                                                                        key={key}
		                                                                                                        className="py-2 font-medium"
		                                                                                                        onSelect={() => selectSingle(target)}
		                                                                                                    >
		                                                                                                        {label}
		                                                                                                    </DropdownMenuItem>
	                                                                                                )
	                                                                                            }
		                                                                                            return (
		                                                                                                <DropdownMenuCheckboxItem
		                                                                                                    key={key}
		                                                                                                    className="py-2 font-medium"
		                                                                                                    checked={selectedKeys.has(key)}
		                                                                                                    onSelect={(e) => e.preventDefault()}
		                                                                                                    onCheckedChange={(next) =>
		                                                                                                        addOrRemove(target, Boolean(next))
	                                                                                                    }
	                                                                                                >
	                                                                                                    {label}
	                                                                                                </DropdownMenuCheckboxItem>
	                                                                                            )
	                                                                                        })
	                                                                                    )}
	                                                                                    <DropdownMenuSeparator />
		                                                                                </div>
		                                                                            )
		                                                                        })}
		                                                                    </div>
		                                                                </ScrollArea>
		                                                            </DropdownMenuSubContent>
		                                                        </DropdownMenuSub>
		                                                    )}
        </>
    )
}
