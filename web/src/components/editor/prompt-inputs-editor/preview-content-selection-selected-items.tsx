'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { getChapterDisplayLabel, getSnippetDisplayTitle, selectionKey } from '@/components/editor/prompt-inputs-editor/utils'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import type { PreviewContentSelectionSectionProps } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'

export function PreviewContentSelectionSelectedItems({
    model,
    controller,
}: Omit<PreviewContentSelectionSectionProps, 'input'>) {
    const {
        t,
        disabled,
        chapterTitleSeparator,
        labelPickerById,
        sortedActs,
        sortedChapters,
        snippetPickerSnippets,
        termEntriesById,
    } = model
    const {
        fullNovelTreatLabel,
        actTreatLabel,
        chapterTreatLabel,
        sceneTreatLabel,
        labelTreatSummary,
        addOrRemove,
        state,
    } = controller

    return (
        <>
		                                            {state.selections.length === 0 ? (
		                                                <div className="text-sm text-muted-foreground px-1 py-2">
		                                                    {t('advanced.preview.noneSelected')}
		                                                </div>
		                                            ) : (
			                                                state.selections.map((selection) => {
			                                                    const key = selectionKey(selection)
				                                                    const remove = () => addOrRemove(selection, false)
					                                                    const treatLabel =
					                                                        selection.kind === 'full_novel'
					                                                            ? fullNovelTreatLabel
					                                                            : selection.kind === 'act'
					                                                                ? actTreatLabel
					                                                                : selection.kind === 'chapter'
					                                                                    ? chapterTreatLabel
					                                                                    : selection.kind === 'scene'
					                                                                        ? sceneTreatLabel
					                                                                        : selection.kind === 'label'
					                                                                            ? labelTreatSummary
					                                                                        : null
			
			                                                    let labelNode: ReactNode = null
			                                                    let labelText = ''
			                                                    if (selection.kind === 'full_novel') {
			                                                        labelText = t('advanced.contentSelection.fullNovel')
			                                                    } else if (selection.kind === 'act') {
			                                                        const act = sortedActs.find((a) => a.number === selection.actNumber) ?? null
			                                                        const base = t('advanced.contentSelection.actLabel', { number: selection.actNumber })
			                                                        labelText = act?.title?.trim() ? `${base}: ${act.title.trim()}` : base
				                                                    } else if (selection.kind === 'chapter') {
					                                                        const chapter = sortedChapters.find((c) => c.id === selection.chapterId) ?? null
					                                                        if (chapter) {
						                                                            const base = t('advanced.contentSelection.chapterLabel', { number: chapter.displayNumber })
					                                                            labelText = getChapterDisplayLabel({
					                                                                title: chapter.title,
					                                                                displayNumber: chapter.displayNumber,
					                                                                labelBase: base,
					                                                                chapterWord: t('advanced.contentSelection.chapter'),
					                                                                separator: chapterTitleSeparator,
					                                                            })
					                                                        } else {
					                                                            labelText = `${t('advanced.contentSelection.chapter')} (${selection.chapterId.slice(0, 8)})`
					                                                        }
					                                                    } else if (selection.kind === 'act_outline') {
					                                                        const act = sortedActs.find((a) => a.number === selection.actNumber) ?? null
					                                                        const base = t('advanced.contentSelection.actLabel', { number: selection.actNumber })
					                                                        const actLabel = act?.title?.trim() ? `${base}: ${act.title.trim()}` : base
					                                                        labelText = `${t('advanced.contentSelection.actOutline')}: ${actLabel}`
					                                                    } else if (selection.kind === 'chapter_outline') {
					                                                        const chapter = sortedChapters.find((c) => c.id === selection.chapterId) ?? null
					                                                        if (chapter) {
						                                                        const base = t('advanced.contentSelection.chapterLabel', { number: chapter.displayNumber })
					                                                            const chapterLabel = getChapterDisplayLabel({
					                                                                title: chapter.title,
					                                                                displayNumber: chapter.displayNumber,
					                                                                labelBase: base,
					                                                                chapterWord: t('advanced.contentSelection.chapter'),
					                                                                separator: chapterTitleSeparator,
					                                                            })
					                                                            labelText = `${t('advanced.contentSelection.chapterOutline')}: ${chapterLabel}`
					                                                        } else {
					                                                            labelText = `${t('advanced.contentSelection.chapterOutline')} (${selection.chapterId.slice(0, 8)})`
					                                                        }
				                                                    } else if (selection.kind === 'scene') {
				                                                        const foundChapter =
				                                                            sortedChapters.find((c) =>
				                                                                c.scenes.some((s) => s.id === selection.sceneId)
		                                                            ) ?? null
		                                                        if (foundChapter) {
		                                                            const sceneIndex = foundChapter.scenes.findIndex(
		                                                                (s) => s.id === selection.sceneId
		                                                            )
			                                                            const chapterBase = t('advanced.contentSelection.chapterLabel', {
			                                                                number: foundChapter.displayNumber,
			                                                            })
			                                                            const sceneLabel = t('advanced.contentSelection.sceneLabel', {
			                                                                number: sceneIndex + 1,
			                                                            })
			                                                            labelText = `${chapterBase} · ${sceneLabel}`
			                                                        } else {
			                                                            labelText = `${t('advanced.contentSelection.scene')} (${selection.sceneId.slice(0, 8)})`
			                                                        }
			                                                    } else if (selection.kind === 'snippet') {
			                                                        const snippet =
			                                                            snippetPickerSnippets.find((s) => s.id === selection.snippetId) ??
			                                                            null
		                                                        const title = snippet
		                                                            ? getSnippetDisplayTitle(
		                                                                snippet,
			                                                                t('advanced.contentSelection.snippetPicker.untitledSnippet')
			                                                            )
			                                                            : selection.snippetId.slice(0, 8)
			                                                        labelText = `${t('advanced.contentSelection.snippet')}: ${title}`
			                                                    } else if (selection.kind === 'term') {
			                                                        const entry = termEntriesById.get(selection.termId) ?? null
			                                                        const title = entry?.title?.trim() ? entry.title.trim() : selection.termId.slice(0, 8)
			                                                        const colorId = getTermEntryColorId(entry?.color)
			                                                        const colorClasses = getTermEntryColorClasses(colorId)
			                                                        const hasCustomColor = colorId !== 'black'
			                                                        labelNode = (
			                                                            <span className="inline-flex items-center gap-2 min-w-0">
			                                                                <span
			                                                                    className={cn('h-2 w-2 rounded-full', colorClasses.dot)}
			                                                                    aria-hidden="true"
			                                                                />
			                                                                <span
			                                                                    className={cn(
			                                                                        'truncate',
			                                                                        hasCustomColor && colorClasses.text
			                                                                    )}
			                                                                >
			                                                                    {t('advanced.contentSelection.term')}: {title}
				                                                                </span>
				                                                            </span>
				                                                        )
				                                                    } else if (selection.kind === 'label') {
				                                                        const label = labelPickerById.get(selection.labelId) ?? null
				                                                        const name = label?.name?.trim() ? label.name.trim() : selection.labelId.slice(0, 8)
			                                                        const chipColor = label?.color ?? '#000000'
			                                                        labelNode = (
			                                                            <span className="inline-flex items-center gap-2 min-w-0">
			                                                                <span
			                                                                    className="inline-block h-3 w-3 rounded-sm border"
			                                                                    style={{
			                                                                        backgroundColor: chipColor,
			                                                                        borderColor: chipColor,
			                                                                    }}
			                                                                    aria-hidden="true"
			                                                                />
			                                                                <span className="truncate">
				                                                                    {t('advanced.contentSelection.label')}: {name}
				                                                                </span>
				                                                            </span>
				                                                        )
				                                                    } else if (selection.kind === 'term_tag') {
				                                                        labelText = `${t('advanced.contentSelection.termTag')}: ${selection.tag}`
				                                                    }
			
			                                                    if (!labelNode) {
			                                                        labelNode = <span className="truncate">{labelText}</span>
			                                                    }
			
			                                                    return (
			                                                        <div
			                                                            key={key}
			                                                            className="inline-flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-sm"
			                                                        >
			                                                            <div className="max-w-[240px] min-w-0">{labelNode}</div>
			                                                            {treatLabel && (
			                                                                <span className="text-xs text-muted-foreground">
			                                                                    {treatLabel}
			                                                                </span>
			                                                            )}
		                                                            <button
		                                                                type="button"
		                                                                disabled={disabled}
		                                                                className={cn(
		                                                                    'ml-1 rounded-sm p-0.5 text-muted-foreground hover:text-foreground',
		                                                                    disabled && 'opacity-60'
		                                                                )}
		                                                                onClick={remove}
		                                                            >
		                                                                <X className="h-3 w-3" />
		                                                            </button>
		                                                        </div>
		                                                    )
		                                                })
		                                            )}
        </>
    )
}
