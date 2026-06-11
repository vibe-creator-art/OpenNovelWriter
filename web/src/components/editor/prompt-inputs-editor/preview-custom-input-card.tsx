'use client'

import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import type { PromptCustomInputDefinition, PromptDropdownOption } from '@/lib/prompt-inputs'
import { Button } from '@/components/ui/button'
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Ban, CheckSquare } from 'lucide-react'
import {
    buildMultiSelectionLabel,
    buildSingleSelectionLabel,
    getOptionColorChipStyle,
    getOptionColorDotStyle,
} from '@/components/editor/prompt-inputs-editor/utils'
import { PreviewInputCardFrame } from '@/components/editor/prompt-inputs-editor/preview-input-card-frame'

const EMPTY_OPTIONS: PromptDropdownOption[] = []

export function PreviewCustomInputCard({
    input,
    model,
}: {
    input: PromptCustomInputDefinition
    model: InputsEditorModel
}) {
    const { t, customPreviewStateByInputId, handleUpdateCustomPreviewState } = model
    const title = input.name.trim() || t('advanced.inputs.untitled')
    const description = input.description?.trim() ? input.description : null

    const pDropdownEnabled = input.custom.dropdown.enabled
    const pTextEnabled = input.custom.text.enabled
    const pAllowMultiple = input.custom.dropdown.allowMultiple
    const options = input.custom.dropdown.options ?? EMPTY_OPTIONS
    const dropdownSelectable = pDropdownEnabled && options.length > 0
    const pickerDisplay = input.custom.dropdown.display
    const state = customPreviewStateByInputId[input.id] ?? input.custom.defaultContent
    const selectedIds = pAllowMultiple ? state.dropdownOptionIds : state.dropdownOptionIds.slice(0, 1)
    const hasSelection = selectedIds.length > 0
    const selectionLabel = pAllowMultiple
        ? buildMultiSelectionLabel({ selectedIds, options, t })
        : buildSingleSelectionLabel({
            selectedId: selectedIds[0] ?? null,
            options,
            placeholder: t('advanced.preview.noneSelected'),
        })

    return (
        <PreviewInputCardFrame
            key={`${input.id}:${input.collapsed ? 'collapsed' : 'expanded'}`}
            title={title}
            description={description}
            required={input.required}
            requiredLabel={t('advanced.inputs.requiredBadge')}
            collapsible={input.collapsed}
            expandLabel={t('advanced.inputs.expand')}
            collapseLabel={t('advanced.inputs.collapse')}
        >
            <div
				                                                className={cn(
				                                                    'grid gap-2',
				                                                    dropdownSelectable &&
				                                                        pTextEnabled &&
				                                                        'md:grid-cols-[1fr_auto_1fr] md:items-center'
				                                                )}
				                                            >
				                                                {dropdownSelectable &&
				                                                    (pickerDisplay === 'menu' ? (
			                                                    <DropdownMenu>
			                                                        <DropdownMenuTrigger asChild>
			                                                            <Button variant="outline" className="w-full justify-between">
			                                                                <span className="truncate">{selectionLabel}</span>
			                                                            </Button>
			                                                        </DropdownMenuTrigger>
			                                                        <DropdownMenuContent align="start" className="min-w-[320px]">
				                                                            {pAllowMultiple ? (
				                                                                <>
				                                                                    <DropdownMenuItem
				                                                                        disabled={options.length === 0}
				                                                                        onSelect={(e) => {
			                                                                            e.preventDefault()
			                                                                            handleUpdateCustomPreviewState(
			                                                                                input.id,
			                                                                                input.custom.defaultContent,
			                                                                                (prev) => ({
			                                                                                    ...prev,
			                                                                                    dropdownOptionIds: options.map((opt) => opt.id),
			                                                                                })
			                                                                            )
			                                                                        }}
				                                                                    >
				                                                                        {t('advanced.preview.selectAll')}
				                                                                    </DropdownMenuItem>
				                                                                    <DropdownMenuItem
				                                                                        disabled={!hasSelection}
				                                                                        onSelect={(e) => {
				                                                                            e.preventDefault()
				                                                                            handleUpdateCustomPreviewState(
				                                                                                input.id,
			                                                                                input.custom.defaultContent,
			                                                                                (prev) => ({
			                                                                                    ...prev,
			                                                                                    dropdownOptionIds: [],
			                                                                                })
			                                                                            )
			                                                                        }}
			                                                                    >
			                                                                        {t('advanced.preview.clearSelection')}
			                                                                    </DropdownMenuItem>
			                                                                    <DropdownMenuSeparator />
			                                                                    {options.map((opt) => {
			                                                                        const checked = selectedIds.includes(opt.id)
												const optionColorStyle = getOptionColorDotStyle(opt.color)
												return (
													<DropdownMenuCheckboxItem
			                                                                                key={opt.id}
			                                                                                checked={checked}
			                                                                                onSelect={(e) => e.preventDefault()}
			                                                                                onCheckedChange={(next) => {
			                                                                                    const shouldCheck = Boolean(next)
			                                                                                    const nextIds = shouldCheck
			                                                                                        ? [...new Set([...selectedIds, opt.id])]
			                                                                                        : selectedIds.filter((id) => id !== opt.id)
			                                                                                    handleUpdateCustomPreviewState(
			                                                                                        input.id,
			                                                                                        input.custom.defaultContent,
			                                                                                        (prev) => ({
			                                                                                            ...prev,
			                                                                                            dropdownOptionIds: nextIds,
			                                                                                        })
			                                                                                    )
			                                                                                }}
			                                                                            >
			                                                                                <div className="flex items-start gap-2 min-w-0">
															{optionColorStyle && (
																<span
																	className="mt-0.5 h-4 w-4 rounded-full border shrink-0"
																	style={optionColorStyle}
																	aria-hidden="true"
																/>
															)}
			                                                                                    <div className="min-w-0">
			                                                                                        <div className="truncate">
			                                                                                            {opt.label.trim() ||
			                                                                                                t('advanced.dropdown.untitledOption')}
			                                                                                        </div>
			                                                                                        {opt.description?.trim() && (
			                                                                                            <div className="truncate text-xs text-muted-foreground">
			                                                                                                {opt.description}
			                                                                                            </div>
			                                                                                        )}
			                                                                                    </div>
			                                                                                </div>
			                                                                            </DropdownMenuCheckboxItem>
			                                                                        )
			                                                                    })}
			                                                                </>
				                                                            ) : (
				                                                                <>
				                                                                    <DropdownMenuItem
				                                                                        disabled={selectedIds.length === 0}
				                                                                        onSelect={(e) => {
				                                                                            e.preventDefault()
				                                                                            handleUpdateCustomPreviewState(
				                                                                                input.id,
				                                                                                input.custom.defaultContent,
				                                                                                (prev) => ({
				                                                                                    ...prev,
				                                                                                    dropdownOptionIds: [],
				                                                                                })
				                                                                            )
				                                                                        }}
				                                                                    >
				                                                                        {t('advanced.preview.clearSelection')}
				                                                                    </DropdownMenuItem>
				                                                                    <DropdownMenuSeparator />
					                                                                    <DropdownMenuRadioGroup
					                                                                        value={selectedIds[0] ?? ''}
					                                                                        onValueChange={(next) => {
					                                                                            handleUpdateCustomPreviewState(
					                                                                                input.id,
					                                                                                input.custom.defaultContent,
					                                                                                (prev) => ({
					                                                                                    ...prev,
					                                                                                    dropdownOptionIds: next ? [next] : [],
					                                                                                    text: pTextEnabled ? '' : prev.text,
					                                                                                })
					                                                                            )
					                                                                        }}
					                                                                    >
				                                                                        {options.map((opt) => {
													const optionColorStyle = getOptionColorDotStyle(opt.color)
													return (
														<DropdownMenuRadioItem key={opt.id} value={opt.id}>
															<div className="flex items-start gap-2 min-w-0">
																{optionColorStyle && (
																	<span
																		className="mt-0.5 h-4 w-4 rounded-full border shrink-0"
																		style={optionColorStyle}
																		aria-hidden="true"
																	/>
																)}
				                                                                                        <div className="min-w-0">
				                                                                                            <div className="truncate">
				                                                                                                {opt.label.trim() ||
				                                                                                                    t('advanced.dropdown.untitledOption')}
				                                                                                            </div>
				                                                                                            {opt.description?.trim() && (
				                                                                                                <div className="truncate text-xs text-muted-foreground">
				                                                                                                    {opt.description}
				                                                                                                </div>
				                                                                                            )}
				                                                                                        </div>
				                                                                                    </div>
				                                                                                </DropdownMenuRadioItem>
				                                                                            )
				                                                                        })}
				                                                                    </DropdownMenuRadioGroup>
				                                                                </>
				                                                            )}
				                                                        </DropdownMenuContent>
				                                                    </DropdownMenu>
				                                                ) : (
			                                                    <div className="w-full flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
			                                                        {options.map((opt) => {
				                                                            const selected = selectedIds.includes(opt.id)
													const optionColorStyle = getOptionColorChipStyle(opt.color)
											const label = opt.label.trim() || t('advanced.dropdown.untitledOption')
											return (
												<button
				                                                                    key={opt.id}
				                                                                    type="button"
													className={cn(
														'inline-flex max-w-full items-center rounded-md border px-2 py-1 text-xs font-medium transition-colors transition-opacity',
														'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
														'text-foreground bg-background hover:bg-muted/30',
														!selected && (opt.color ? 'opacity-35 hover:opacity-70 focus-visible:opacity-100' : 'opacity-40 hover:opacity-70 focus-visible:opacity-100'),
														selected && 'border-sky-500 dark:border-sky-400'
													)}
													style={optionColorStyle}
													onClick={() => {
				                                                                        handleUpdateCustomPreviewState(
			                                                                            input.id,
			                                                                            input.custom.defaultContent,
				                                                                            (prev) => {
				                                                                                const current = pAllowMultiple
				                                                                                    ? prev.dropdownOptionIds
				                                                                                    : prev.dropdownOptionIds.slice(0, 1)
				                                                                                const shouldClearText = !pAllowMultiple && pTextEnabled
				                                                                                const has = current.includes(opt.id)
				                                                                                const nextIds = pAllowMultiple
				                                                                                    ? has
				                                                                                        ? current.filter((id) => id !== opt.id)
				                                                                                        : [...new Set([...current, opt.id])]
				                                                                                    : has
				                                                                                        ? []
				                                                                                        : [opt.id]
				                                                                                return {
				                                                                                    ...prev,
				                                                                                    dropdownOptionIds: nextIds,
				                                                                                    text: shouldClearText ? '' : prev.text,
				                                                                                }
				                                                                            }
				                                                                        )
				                                                                    }}
			                                                                >
			                                                                    <span className="truncate">{label}</span>
			                                                                </button>
			                                                            )
			                                                        })}

				                                                        <button
				                                                            type="button"
				                                                            disabled={!hasSelection}
				                                                            className={cn(
				                                                                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
				                                                                'bg-background hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60',
				                                                                hasSelection ? 'text-foreground' : 'text-muted-foreground'
				                                                            )}
				                                                            onClick={() =>
				                                                                handleUpdateCustomPreviewState(
				                                                                    input.id,
				                                                                    input.custom.defaultContent,
			                                                                    (prev) => ({
			                                                                        ...prev,
			                                                                        dropdownOptionIds: [],
			                                                                    })
			                                                                )
			                                                            }
			                                                        >
			                                                            <Ban className="h-4 w-4" />
			                                                            {t('advanced.preview.clearSelection')}
			                                                        </button>

				                                                        {pAllowMultiple && (
				                                                            <button
				                                                                type="button"
				                                                                className={cn(
				                                                                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
				                                                                    'bg-background hover:bg-muted/30 text-foreground'
				                                                                )}
				                                                                onClick={() =>
				                                                                    handleUpdateCustomPreviewState(
				                                                                        input.id,
				                                                                        input.custom.defaultContent,
			                                                                        (prev) => ({
			                                                                            ...prev,
			                                                                            dropdownOptionIds: options.map((opt) => opt.id),
			                                                                        })
			                                                                    )
			                                                                }
			                                                            >
			                                                                <CheckSquare className="h-4 w-4" />
			                                                                {t('advanced.preview.selectAll')}
			                                                            </button>
			                                                        )}
			                                                    </div>
			                                                ))}
	
		                                            {dropdownSelectable && pTextEnabled && (
		                                                <div className="text-xs font-semibold text-muted-foreground text-center">
		                                                    {pAllowMultiple ? t('advanced.defaultContent.and') : t('advanced.defaultContent.or')}
		                                                </div>
		                                            )}

			                                            {pTextEnabled && (
			                                                <AutoResizeTextarea
		                                                    value={state.text}
		                                                    rows={1}
		                                                    onChange={(e) => {
		                                                        const nextText = e.target.value
		                                                        handleUpdateCustomPreviewState(
		                                                            input.id,
		                                                            input.custom.defaultContent,
		                                                            (prev) => ({
		                                                                ...prev,
		                                                                text: nextText,
		                                                                dropdownOptionIds:
		                                                                    !pAllowMultiple && dropdownSelectable ? [] : prev.dropdownOptionIds,
		                                                            })
		                                                        )
		                                                    }}
		                                                    className="min-h-9 py-1"
		                                                    placeholder={
		                                                        input.custom.text.placeholder.trim() || t('advanced.preview.textPlaceholder')
			                                                    }
			                                                />
			                                            )}
			                                        </div>
        </PreviewInputCardFrame>
    )
}
