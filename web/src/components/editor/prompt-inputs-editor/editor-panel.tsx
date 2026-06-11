'use client'

import { useState } from 'react'
import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import { DisplayNameEditor, SortableOptionRow, TreatAsSegment } from '@/components/editor/prompt-inputs-editor/components'
import type { CustomPreviewState } from '@/components/editor/prompt-inputs-editor/types'
	import { Button } from '@/components/ui/button'
	import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea'
	import { Input } from '@/components/ui/input'
	import { Label } from '@/components/ui/label'
	import { Separator } from '@/components/ui/separator'
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
import {
    AlignLeft,
    ArrowDownAZ,
    ArrowUpRight,
    Ban,
    BookOpen,
    BookText,
    Bookmark,
    CheckSquare,
    ChevronDown,
    ClipboardList,
    FileText,
    Folder,
    LayoutGrid,
    List,
    ListChecks,
    MapPin,
    MessageSquare,
    MoreHorizontal,
    Plus,
    Shapes,
    SlidersHorizontal,
    StickyNote,
    Tag,
    Trash2,
    UserRound,
} from 'lucide-react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
    getOptionColorChipStyle,
    getOptionColorDotStyle,
} from '@/components/editor/prompt-inputs-editor/utils'

export function EditorPanel({ model }: { model: InputsEditorModel }) {
    const {
        t, tTerms, disabled: promptDisabled, selectedInputReadOnly, selectedInputSourcePrompt, selectedInput, checkboxInput,
        contentSelectionInput, customAllowMultiple, customInput, defaultContent, defaultContentLayout, defaultDropdownLabel,
        defaultTextPlaceholder, dropdownDisplay, dropdownEnabled, dropdownOptions, dropdownSettingsOpen, handleAddOption,
        handleDefaultDropdownOptionIdsChange, handleDefaultTextChange, handleDeleteOption, handleDeleteSelectedInput, handleDragEnd, handleSetSelectedInputType,
        handleSortOptions, handleToggleDropdownAllowed, handleToggleTextAllowed, handleUpdateContentSelectionPreviewState, sensors,
        setCheckboxPreviewCheckedByInputId, setCustomPreviewStateByInputId, setEditingOptionId, textEnabled, textSettingsOpen,
        updateAllowedSettingsOpen, updateSelectedInput, usedInputIds, commitInputName, canNavigateToSelectedInputSource, handleNavigateToSelectedInputSource,
    } = model

    const disabled = promptDisabled || selectedInputReadOnly
    const [duplicateNameNoticeInputId, setDuplicateNameNoticeInputId] = useState<string | null>(null)

		    const renderDefaultDropdownPicker = () => {
		        if (!customInput || !customInput.custom.dropdown.enabled || dropdownOptions.length === 0) return null
		        const currentIds = defaultContent.dropdownOptionIds
		        const hasSelection = currentIds.length > 0

		        if (dropdownDisplay !== 'menu') {
		            return (
		                <div className={cn('w-full flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2', disabled && 'opacity-60')}>
		                    {dropdownOptions.map((opt) => {
	                        const selected = currentIds.includes(opt.id)
	                        const optionColorStyle = getOptionColorChipStyle(opt.color)
	                        const label = opt.label.trim() || t('advanced.dropdown.untitledOption')
	                        return (
	                            <button
	                                key={opt.id}
	                                type="button"
	                                disabled={disabled}
	                                className={cn(
	                                    'inline-flex max-w-full items-center rounded-md border px-2 py-1 text-xs font-medium transition-colors transition-opacity',
	                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
	                                    'text-foreground bg-background hover:bg-muted/30',
	                                    !selected && (opt.color ? 'opacity-35 hover:opacity-70 focus-visible:opacity-100' : 'opacity-40 hover:opacity-70 focus-visible:opacity-100'),
	                                    selected && 'border-sky-500 dark:border-sky-400',
	                                    disabled && 'cursor-not-allowed opacity-60'
	                                )}
	                                style={optionColorStyle}
	                                onClick={() => {
	                                    if (disabled) return
	                                    if (customAllowMultiple) {
	                                        const nextIds = selected
	                                            ? currentIds.filter((id) => id !== opt.id)
	                                            : [...new Set([...currentIds, opt.id])]
	                                        handleDefaultDropdownOptionIdsChange(nextIds)
	                                        return
	                                    }
	                                    handleDefaultDropdownOptionIdsChange(selected ? [] : [opt.id])
	                                }}
	                            >
	                                <span className="truncate">{label}</span>
	                            </button>
	                        )
		                    })}

		                    <button
		                        type="button"
		                        disabled={disabled || !hasSelection}
		                        className={cn(
		                            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
		                            'bg-background hover:bg-muted/30',
		                            hasSelection ? 'text-foreground' : 'text-muted-foreground',
		                            (disabled || !hasSelection) && 'cursor-not-allowed opacity-60'
		                        )}
		                        onClick={() => handleDefaultDropdownOptionIdsChange([])}
		                    >
		                        <Ban className="h-4 w-4" />
		                        {t('advanced.preview.clearSelection')}
		                    </button>

		                    {customAllowMultiple && (
		                        <button
		                            type="button"
		                            disabled={disabled}
		                            className={cn(
		                                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
		                                'bg-background hover:bg-muted/30 text-foreground',
		                                disabled && 'cursor-not-allowed opacity-60'
		                            )}
		                            onClick={() => handleDefaultDropdownOptionIdsChange(dropdownOptions.map((opt) => opt.id))}
		                        >
	                            <CheckSquare className="h-4 w-4" />
	                            {t('advanced.preview.selectAll')}
	                        </button>
	                    )}
	                </div>
	            )
	        }

	        const disabledSelector = disabled || dropdownOptions.length === 0
		        if (customAllowMultiple) {
		            return (
		                <DropdownMenu>
		                    <DropdownMenuTrigger asChild>
		                        <Button variant="outline" className="w-full justify-between" disabled={disabledSelector}>
	                            <span className="truncate">{defaultDropdownLabel}</span>
	                        </Button>
	                    </DropdownMenuTrigger>
	                    <DropdownMenuContent align="start" className="min-w-[320px]">
		                        <DropdownMenuItem
		                            disabled={dropdownOptions.length === 0}
		                            onSelect={(e) => {
		                                e.preventDefault()
		                                handleDefaultDropdownOptionIdsChange(dropdownOptions.map((opt) => opt.id))
		                            }}
		                        >
		                            {t('advanced.preview.selectAll')}
		                        </DropdownMenuItem>
		                        <DropdownMenuItem
		                            disabled={!hasSelection}
		                            onSelect={(e) => {
		                                e.preventDefault()
		                                handleDefaultDropdownOptionIdsChange([])
		                            }}
		                        >
		                            {t('advanced.preview.clearSelection')}
	                        </DropdownMenuItem>
	                        <DropdownMenuSeparator />
	                        {dropdownOptions.map((opt) => {
	                            const checked = currentIds.includes(opt.id)
	                            const optionColorStyle = getOptionColorDotStyle(opt.color)
	                            return (
	                                <DropdownMenuCheckboxItem
	                                    key={opt.id}
	                                    checked={checked}
	                                    onSelect={(e) => e.preventDefault()}
	                                    onCheckedChange={(next) => {
	                                        const shouldCheck = Boolean(next)
	                                        const nextIds = shouldCheck
	                                            ? [...new Set([...currentIds, opt.id])]
	                                            : currentIds.filter((id) => id !== opt.id)
	                                        handleDefaultDropdownOptionIdsChange(nextIds)
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
	                                                {opt.label.trim() || t('advanced.dropdown.untitledOption')}
	                                            </div>
	                                            {opt.description?.trim() && (
	                                                <div className="truncate text-xs text-muted-foreground">{opt.description}</div>
	                                            )}
	                                        </div>
	                                    </div>
	                                </DropdownMenuCheckboxItem>
	                            )
	                        })}
	                    </DropdownMenuContent>
	                </DropdownMenu>
	            )
	        }

		        const selectedId = currentIds[0] ?? ''
		        return (
		            <DropdownMenu>
		                <DropdownMenuTrigger asChild>
		                    <Button variant="outline" className="w-full justify-between" disabled={disabledSelector}>
		                        <span className="truncate">{defaultDropdownLabel}</span>
		                    </Button>
		                </DropdownMenuTrigger>
		                <DropdownMenuContent align="start" className="min-w-[320px]">
		                    <DropdownMenuItem
		                        disabled={!selectedId}
		                        onSelect={(e) => {
		                            e.preventDefault()
		                            handleDefaultDropdownOptionIdsChange([])
		                        }}
		                    >
		                        {t('advanced.preview.clearSelection')}
		                    </DropdownMenuItem>
		                    <DropdownMenuSeparator />
		                    <DropdownMenuRadioGroup
		                        value={selectedId}
		                        onValueChange={(next) => {
		                            const nextIds = next ? [next] : []
		                            handleDefaultDropdownOptionIdsChange(nextIds)
	                        }}
	                    >
	                        {dropdownOptions.map((opt) => {
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
	                                                {opt.label.trim() || t('advanced.dropdown.untitledOption')}
	                                            </div>
	                                            {opt.description?.trim() && (
	                                                <div className="truncate text-xs text-muted-foreground">{opt.description}</div>
	                                            )}
	                                        </div>
	                                    </div>
	                                </DropdownMenuRadioItem>
	                            )
	                        })}
	                    </DropdownMenuRadioGroup>
	                </DropdownMenuContent>
	            </DropdownMenu>
	        )
	    }

    return (
                <div className="rounded-md border bg-card p-4 space-y-4 min-w-0">
                    {!selectedInput ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">
                            {t('advanced.inputs.selectPrompt')}
                        </div>
                    ) : (
		                        <>
		                            <div className="flex items-center justify-between gap-2">
		                                <div className="text-sm font-medium">{t('advanced.inputs.detailsTitle')}</div>
                                        <div className="flex items-center gap-2">
                                            {selectedInputReadOnly && (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="gap-1"
                                                    disabled={!canNavigateToSelectedInputSource}
                                                    onClick={handleNavigateToSelectedInputSource}
                                                >
                                                    <ArrowUpRight className="h-4 w-4" />
                                                    {t('advanced.inputs.jumpToSourceButton')}
                                                </Button>
                                            )}
		                                    <Button
	                                        type="button"
	                                        variant="outline"
	                                        size="sm"
	                                        className="gap-1 text-destructive"
	                                        disabled={disabled}
	                                        onClick={handleDeleteSelectedInput}
	                                    >
	                                        <Trash2 className="h-4 w-4" />
	                                        {t('advanced.inputs.delete')}
		                                    </Button>
                                        </div>
		                            </div>

                                {!usedInputIds.has(selectedInput.id) && (
                                    <div className="rounded-md border bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
                                        {t('advanced.inputs.unusedNotice')}
                                    </div>
                                )}

                                {selectedInputReadOnly && (
                                    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                                        {selectedInputSourcePrompt?.name
                                            ? t('advanced.inputs.includedNoticeWithSource', { name: selectedInputSourcePrompt.name })
                                            : t('advanced.inputs.includedNotice')}
                                    </div>
                                )}

		                            <div className="grid gap-4 md:grid-cols-2">
	                                <div className="space-y-2">
	                                    <Label htmlFor="prompt-input-name">{t('advanced.inputs.name')}</Label>
	                                    <Input
				                                        key={`${selectedInput.id}:${selectedInput.name}`}
		                                        id="prompt-input-name"
		                                        disabled={disabled}
				                                        defaultValue={selectedInput.name}
				                                        onChange={() => {
				                                            if (duplicateNameNoticeInputId === selectedInput.id) {
				                                                setDuplicateNameNoticeInputId(null)
				                                            }
				                                        }}
				                                        onBlur={(e) => {
				                                            const committed = commitInputName(selectedInput.id, e.currentTarget.value)
				                                            if (!committed) {
				                                                setDuplicateNameNoticeInputId(selectedInput.id)
				                                                e.currentTarget.value = selectedInput.name
				                                            } else if (duplicateNameNoticeInputId === selectedInput.id) {
				                                                setDuplicateNameNoticeInputId(null)
				                                            }
				                                        }}
				                                        onKeyDown={(e) => {
				                                            if (e.key === 'Enter') {
				                                                e.preventDefault()
				                                                const committed = commitInputName(selectedInput.id, e.currentTarget.value)
				                                                if (!committed) {
				                                                    setDuplicateNameNoticeInputId(selectedInput.id)
				                                                    e.currentTarget.value = selectedInput.name
				                                                } else if (duplicateNameNoticeInputId === selectedInput.id) {
				                                                    setDuplicateNameNoticeInputId(null)
				                                                }
				                                                ;(e.currentTarget as HTMLInputElement).blur()
				                                            }
				                                            if (e.key === 'Escape') {
				                                                e.preventDefault()
				                                                if (duplicateNameNoticeInputId === selectedInput.id) {
				                                                    setDuplicateNameNoticeInputId(null)
				                                                }
				                                                e.currentTarget.value = selectedInput.name
				                                                ;(e.currentTarget as HTMLInputElement).blur()
				                                            }
				                                        }}
				                                    />
	                                    {duplicateNameNoticeInputId === selectedInput.id && (
	                                        <div className="text-xs text-destructive">
	                                            {t('advanced.inputs.duplicateNameNotice')}
	                                        </div>
	                                    )}
			                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="prompt-input-desc">{t('advanced.inputs.description')}</Label>
                                    <Input
                                        id="prompt-input-desc"
                                        disabled={disabled}
                                        value={selectedInput.description ?? ''}
                                        onChange={(e) =>
                                            updateSelectedInput((prev) => ({
                                                ...prev,
                                                description: e.target.value.trim() ? e.target.value : null,
                                            }))
                                        }
                                        placeholder={t('advanced.inputs.descriptionPlaceholder')}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-6">
                                <label className={cn('flex items-center gap-2 text-sm', disabled && 'opacity-60')}>
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4"
                                        disabled={disabled}
                                        checked={selectedInput.required}
                                        onChange={(e) => updateSelectedInput((prev) => ({ ...prev, required: e.target.checked }))}
                                    />
                                    {t('advanced.inputs.required')}
                                </label>

	                                <label
	                                    className={cn(
	                                        'flex items-center gap-2 text-sm',
	                                        (disabled || selectedInput.type === 'checkbox') && 'opacity-60'
	                                    )}
		                                >
		                                    <input
		                                        type="checkbox"
		                                        className="h-4 w-4"
		                                        disabled={disabled || selectedInput.type === 'checkbox'}
		                                        checked={
		                                            selectedInput.type === 'custom'
		                                                ? selectedInput.custom.dropdown.allowMultiple
		                                                : selectedInput.type === 'content_selection'
		                                                    ? selectedInput.contentSelection.allowMultiple
		                                                    : false
		                                        }
		                                        onChange={(e) => {
			                                            const nextAllowMultiple = e.target.checked
			                                            if (selectedInput.type === 'custom') {
			                                                const inputId = selectedInput.id
				                                                let nextDefault: CustomPreviewState | null = null
				                                                updateSelectedInput((prev) => {
				                                                    if (prev.type !== 'custom') return prev
				                                                    const updatedDefault: CustomPreviewState = {
				                                                        ...prev.custom.defaultContent,
				                                                        dropdownOptionIds: nextAllowMultiple
				                                                            ? prev.custom.defaultContent.dropdownOptionIds
				                                                            : prev.custom.defaultContent.dropdownOptionIds.slice(0, 1),
				                                                    }
				                                                    nextDefault = updatedDefault
				                                                    return {
				                                                        ...prev,
				                                                        custom: {
				                                                            ...prev.custom,
				                                                            dropdown: {
				                                                                ...prev.custom.dropdown,
				                                                                allowMultiple: nextAllowMultiple,
				                                                            },
				                                                            defaultContent: updatedDefault,
				                                                        },
				                                                    }
				                                                })
		                                                    if (nextDefault) {
		                                                        const defaultToStore = nextDefault
		                                                        setCustomPreviewStateByInputId((prev) => ({
		                                                            ...prev,
		                                                            [inputId]: defaultToStore,
		                                                        }))
		                                                    }
			                                                return
			                                            }

			                                            if (selectedInput.type !== 'content_selection') return
			                                            const inputId = selectedInput.id
			                                            updateSelectedInput((prev) => {
			                                                if (prev.type !== 'content_selection') return prev
			                                                return {
			                                                    ...prev,
			                                                    contentSelection: {
			                                                        ...prev.contentSelection,
			                                                        allowMultiple: nextAllowMultiple,
			                                                    },
			                                                }
			                                            })
	                                            if (!nextAllowMultiple) {
	                                                handleUpdateContentSelectionPreviewState(
	                                                    inputId,
	                                                    { selections: [] },
	                                                    (prev) => ({
	                                                        ...prev,
	                                                        selections: prev.selections.slice(0, 1),
			                                                    })
			                                                )
			                                            }
			                                        }}
	                                    />
	                                    {t('advanced.inputs.allowMultiple')}
	                                </label>

	                                <label className={cn('flex items-center gap-2 text-sm', disabled && 'opacity-60')}>
	                                    <input
	                                        type="checkbox"
	                                        className="h-4 w-4"
	                                        disabled={disabled}
	                                        checked={selectedInput.collapsed}
	                                        onChange={(e) =>
	                                            updateSelectedInput((prev) => ({
	                                                ...prev,
	                                                collapsed: e.target.checked,
	                                            }))
	                                        }
	                                    />
	                                    {t('advanced.inputs.collapsed')}
	                                </label>
	                            </div>

		                            <Separator />
			
		                            <div className="space-y-3">
		                                <div className="space-y-1">
                                    <div className="text-sm font-medium">{t('advanced.allowedContent.title')}</div>
                                    <div className="text-xs text-muted-foreground">{t('advanced.allowedContent.help')}</div>
                                </div>

	                                <div className="space-y-2">
		                                    <label
		                                        className={cn(
		                                            'flex items-start gap-3 rounded-md border p-3',
		                                            selectedInput.type === 'custom' && 'ring-1 ring-primary/40'
		                                        )}
		                                    >
		                                        <input
		                                            type="radio"
		                                            name={`prompt-input-type-${selectedInput.id}`}
		                                            className="mt-1 h-4 w-4"
		                                            disabled={disabled}
		                                            checked={selectedInput.type === 'custom'}
		                                            onChange={() => handleSetSelectedInputType('custom')}
		                                        />
		                                        <div className="mt-0.5 h-8 w-8 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
		                                            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
		                                        </div>
		                                        <div className="min-w-0">
		                                            <div className="text-sm font-medium">{t('advanced.allowedContent.customTitle')}</div>
		                                            <div className="text-xs text-muted-foreground">{t('advanced.allowedContent.customHint')}</div>
		                                        </div>
		                                    </label>

		                                    <label
		                                        className={cn(
		                                            'flex items-start gap-3 rounded-md border p-3',
		                                            selectedInput.type === 'content_selection' && 'ring-1 ring-primary/40',
		                                            disabled && 'opacity-60'
		                                        )}
		                                    >
		                                        <input
		                                            type="radio"
		                                            name={`prompt-input-type-${selectedInput.id}`}
		                                            className="mt-1 h-4 w-4"
		                                            disabled={disabled}
		                                            checked={selectedInput.type === 'content_selection'}
		                                            onChange={() => handleSetSelectedInputType('content_selection')}
		                                        />
		                                        <div className="mt-0.5 h-8 w-8 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
		                                            <ListChecks className="h-4 w-4 text-muted-foreground" />
		                                        </div>
		                                        <div className="min-w-0">
		                                            <div className="text-sm font-medium">{t('advanced.allowedContent.contentSelectionTitle')}</div>
		                                            <div className="text-xs text-muted-foreground">{t('advanced.allowedContent.contentSelectionHint')}</div>
		                                        </div>
		                                    </label>

			                                    <label
			                                        className={cn(
			                                            'flex items-start gap-3 rounded-md border p-3',
			                                            selectedInput.type === 'checkbox' && 'ring-1 ring-primary/40',
			                                            disabled && 'opacity-60'
			                                        )}
			                                    >
			                                        <input
			                                            type="radio"
			                                            name={`prompt-input-type-${selectedInput.id}`}
			                                            className="mt-1 h-4 w-4"
			                                            disabled={disabled}
			                                            checked={selectedInput.type === 'checkbox'}
			                                            onChange={() => handleSetSelectedInputType('checkbox')}
			                                        />
			                                        <div className="mt-0.5 h-8 w-8 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
			                                            <CheckSquare className="h-4 w-4 text-muted-foreground" />
			                                        </div>
			                                        <div className="min-w-0">
			                                            <div className="text-sm font-medium">{t('advanced.allowedContent.checkboxTitle')}</div>
			                                            <div className="text-xs text-muted-foreground">{t('advanced.allowedContent.checkboxHint')}</div>
			                                        </div>
			                                    </label>
	                                </div>

			                                {checkboxInput && (
			                                    <div className="rounded-md border bg-background p-3 space-y-4">
			                                        <div className="space-y-2">
			                                            <Label htmlFor={`prompt-input-checkbox-display-name-${selectedInput.id}`}>
			                                                {t('advanced.contentSelection.displayNameLabel')}
			                                            </Label>
			                                            <DisplayNameEditor
			                                                key={selectedInput.id}
			                                                id={`prompt-input-checkbox-display-name-${selectedInput.id}`}
			                                                disabled={disabled}
			                                                baseName={checkboxInput.name.trim()}
			                                                storedDisplayName={checkboxInput.checkbox.displayName}
			                                                untitledLabel={t('advanced.inputs.untitled')}
			                                                onCommit={(raw) =>
			                                                    updateSelectedInput((prev) => {
			                                                        if (prev.type !== 'checkbox') return prev
			                                                        const trimmed = raw.trim()
			                                                        const base = prev.name.trim()
			                                                        const next =
			                                                            trimmed.length === 0 || (base && trimmed === base) ? '' : raw
			                                                        return { ...prev, checkbox: { ...prev.checkbox, displayName: next } }
			                                                    })
			                                                }
			                                            />
			                                            <div className="text-xs text-muted-foreground">
			                                                {t('advanced.contentSelection.displayNameHint')}
			                                            </div>
			                                        </div>

			                                        <Separator />

				                                        <div className="space-y-2">
				                                            <div className="space-y-1">
				                                                <div className="text-sm font-medium">{t('advanced.defaultContent.title')}</div>
				                                                <div className="text-xs text-muted-foreground">
				                                                    {t('advanced.checkbox.defaultContentHint')}
				                                                </div>
				                                            </div>
				                                            <label
				                                                className={cn(
				                                                    'flex items-center gap-2 rounded-md bg-muted/20 px-3 py-2 text-sm',
				                                                    disabled && 'opacity-60 cursor-not-allowed'
				                                                )}
				                                            >
				                                                <input
				                                                    type="checkbox"
			                                                    className="h-4 w-4"
			                                                    disabled={disabled}
			                                                    checked={checkboxInput.checkbox.defaultChecked}
			                                                    onChange={(e) => {
			                                                        const inputId = checkboxInput.id
			                                                        const nextChecked = e.target.checked
			                                                        updateSelectedInput((prev) => {
			                                                            if (prev.type !== 'checkbox') return prev
			                                                            return {
			                                                                ...prev,
			                                                                checkbox: { ...prev.checkbox, defaultChecked: nextChecked },
			                                                            }
			                                                        })
				                                                        setCheckboxPreviewCheckedByInputId((prev) => ({
				                                                            ...prev,
				                                                            [inputId]: nextChecked,
				                                                        }))
				                                                    }}
				                                                />
				                                                <span className="min-w-0 truncate">
				                                                    {checkboxInput.checkbox.displayName.trim() ||
				                                                        checkboxInput.name.trim() ||
				                                                        t('advanced.inputs.untitled')}
				                                                </span>
				                                            </label>
				                                        </div>
				                                    </div>
				                                )}

		                                {customInput && (
		                                    <div className="space-y-3">
		                                    {/* Text */}
		                                    <div className="rounded-md border">
	                                        <div className="flex items-start gap-2 p-3">
	                                            <input
	                                                type="checkbox"
                                                className="mt-1 h-4 w-4"
                                                disabled={disabled || (textEnabled && !dropdownEnabled)}
                                                checked={textEnabled}
                                                onChange={(e) => {
                                                    const nextEnabled = e.target.checked
                                                    handleToggleTextAllowed(nextEnabled)
                                                    if (nextEnabled) {
                                                        updateAllowedSettingsOpen((prev) => ({ ...prev, text: true }))
                                                    } else if (dropdownEnabled) {
                                                        updateAllowedSettingsOpen((prev) => ({ ...prev, text: false }))
                                                    }
                                                }}
                                            />
                                            <button
                                                type="button"
                                                className={cn('min-w-0 flex-1 text-left', !textEnabled && 'opacity-60')}
                                                disabled={disabled || !textEnabled}
                                                onClick={() =>
                                                    updateAllowedSettingsOpen((prev) => ({ ...prev, text: !prev.text }))
                                                }
	                                            >
	                                                <div className="flex items-center justify-between gap-2">
	                                                    <div className="flex items-center gap-2 min-w-0">
	                                                        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
	                                                            <AlignLeft className="h-4 w-4 text-muted-foreground" />
	                                                        </div>
	                                                        <div className="text-sm font-medium truncate">
	                                                            {t('advanced.allowedContent.text')}
	                                                        </div>
	                                                    </div>
	                                                    <ChevronDown
	                                                        className={cn(
	                                                            'h-4 w-4 text-muted-foreground transition-transform',
	                                                            textSettingsOpen && 'rotate-180'
                                                        )}
                                                    />
                                                </div>
                                                <div className="text-xs text-muted-foreground">{t('advanced.allowedContent.textHint')}</div>
                                            </button>
                                        </div>

                                        {textEnabled && textSettingsOpen && (
                                            <div className="border-t bg-muted/20 p-3 space-y-2">
                                                <div className="space-y-1">
                                                    <div className="text-sm font-medium">{t('advanced.allowedContent.textPlaceholderLabel')}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {t('advanced.allowedContent.textPlaceholderHint')}
                                                    </div>
                                                </div>
	                                                <Input
	                                                    disabled={disabled}
	                                                    value={customInput?.custom.text.placeholder ?? ''}
	                                                    onChange={(e) =>
	                                                        updateSelectedInput((prev) => {
	                                                            if (prev.type !== 'custom') return prev
	                                                            return {
	                                                                ...prev,
	                                                                custom: {
	                                                                    ...prev.custom,
	                                                                    text: {
	                                                                        ...prev.custom.text,
	                                                                        placeholder: e.target.value,
	                                                                    },
	                                                                },
	                                                            }
	                                                        })
	                                                    }
	                                                    placeholder={t('advanced.allowedContent.textPlaceholderPlaceholder')}
	                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Dropdown */}
                                    <div className="rounded-md border">
                                        <div className="flex items-start gap-2 p-3">
                                            <input
                                                type="checkbox"
                                                className="mt-1 h-4 w-4"
                                                disabled={disabled || (dropdownEnabled && !textEnabled)}
                                                checked={dropdownEnabled}
                                                onChange={(e) => {
                                                    const nextEnabled = e.target.checked
                                                    handleToggleDropdownAllowed(nextEnabled)
                                                    if (nextEnabled) {
                                                        updateAllowedSettingsOpen((prev) => ({ ...prev, dropdown: true }))
                                                    } else if (textEnabled) {
                                                        updateAllowedSettingsOpen((prev) => ({ ...prev, dropdown: false }))
                                                    }
                                                }}
                                            />
                                            <button
                                                type="button"
                                                className={cn('min-w-0 flex-1 text-left', !dropdownEnabled && 'opacity-60')}
                                                disabled={disabled || !dropdownEnabled}
                                                onClick={() =>
                                                    updateAllowedSettingsOpen((prev) => ({ ...prev, dropdown: !prev.dropdown }))
                                                }
	                                            >
	                                                <div className="flex items-center justify-between gap-2">
	                                                    <div className="flex items-center gap-2 min-w-0">
	                                                        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
	                                                            <List className="h-4 w-4 text-muted-foreground" />
	                                                        </div>
	                                                        <div className="text-sm font-medium truncate">
	                                                            {t('advanced.allowedContent.dropdown')}
	                                                        </div>
	                                                    </div>
	                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
	                                                        <span>
	                                                            {t('advanced.dropdown.optionCount', { count: dropdownOptions.length })}
	                                                        </span>
                                                        <ChevronDown
                                                            className={cn(
                                                                'h-4 w-4 text-muted-foreground transition-transform',
                                                                dropdownSettingsOpen && 'rotate-180'
                                                            )}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="text-xs text-muted-foreground">{t('advanced.allowedContent.dropdownHint')}</div>
                                            </button>
                                        </div>

                                        {dropdownEnabled && dropdownSettingsOpen && (
                                            <div className="border-t bg-muted/20 p-3 space-y-3">
	                                                <div className="flex items-center justify-between gap-2">
	                                                    <div className="text-sm font-medium">{t('advanced.dropdown.title')}</div>
	                                                    <div className="flex items-center gap-2">
	                                                        <Button
	                                                            type="button"
	                                                            variant="outline"
	                                                            size="sm"
	                                                            className="gap-1"
	                                                            disabled={disabled}
	                                                            onClick={() =>
	                                                                updateSelectedInput((prev) => {
	                                                                    if (prev.type !== 'custom') return prev
	                                                                    const nextDisplay =
	                                                                        prev.custom.dropdown.display === 'menu' ? 'chips' : 'menu'
	                                                                    return {
	                                                                        ...prev,
	                                                                        custom: {
	                                                                            ...prev.custom,
	                                                                            dropdown: {
	                                                                                ...prev.custom.dropdown,
	                                                                                display: nextDisplay,
	                                                                            },
	                                                                        },
	                                                                    }
	                                                                })
	                                                            }
	                                                        >
	                                                            {dropdownDisplay === 'menu' ? (
	                                                                <List className="h-4 w-4" />
	                                                            ) : (
	                                                                <LayoutGrid className="h-4 w-4" />
	                                                            )}
	                                                            {dropdownDisplay === 'menu'
	                                                                ? t('advanced.dropdown.displayModeMenu')
	                                                                : t('advanced.dropdown.displayModeChips')}
	                                                        </Button>
	                                                        <Button
	                                                            type="button"
	                                                            variant="outline"
	                                                            size="sm"
	                                                            className="gap-1"
                                                            disabled={disabled || dropdownOptions.length < 2}
                                                            onClick={handleSortOptions}
                                                        >
                                                            <ArrowDownAZ className="h-4 w-4" />
                                                            {t('advanced.dropdown.sort')}
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            className="gap-1"
                                                            disabled={disabled}
                                                            onClick={handleAddOption}
                                                        >
                                                            <Plus className="h-4 w-4" />
                                                            {t('advanced.dropdown.add')}
                                                        </Button>
                                                    </div>
                                                </div>

                                                <DndContext
                                                    sensors={sensors}
                                                    collisionDetection={closestCenter}
                                                    onDragEnd={handleDragEnd}
                                                >
                                                    <SortableContext
                                                        items={dropdownOptions.map((opt) => opt.id)}
                                                        strategy={verticalListSortingStrategy}
                                                    >
                                                        <div className="space-y-2">
                                                            {dropdownOptions.length === 0 ? (
                                                                <div className="rounded-md border bg-muted/30 px-3 py-6 text-sm text-muted-foreground text-center">
                                                                    {t('advanced.dropdown.empty')}
                                                                </div>
                                                            ) : (
                                                                dropdownOptions.map((opt) => (
                                                                    <SortableOptionRow
                                                                        key={opt.id}
                                                                        option={opt}
                                                                        disabled={disabled}
                                                                        onEdit={() => setEditingOptionId(opt.id)}
                                                                        onDelete={() => handleDeleteOption(opt.id)}
                                                                        t={t}
                                                                    />
                                                                ))
                                                            )}
                                                        </div>
                                                    </SortableContext>
                                                </DndContext>
                                            </div>
	                                        )}
			                                    </div>
			                                </div>
			                                )}

		                                {contentSelectionInput && (
		                                    <div className="rounded-md border bg-background p-3 space-y-4">
		                                        <div className="space-y-1">
	                                            <div className="text-sm font-medium">{t('advanced.contentSelection.title')}</div>
	                                            <div className="text-xs text-muted-foreground">{t('advanced.contentSelection.hint')}</div>
	                                        </div>

	                                        <div className="space-y-3">
	                                            <div className="flex items-start gap-2">
		                                                <input
		                                                    type="checkbox"
		                                                    className="mt-1 h-4 w-4"
			                                                    disabled={disabled}
			                                                    checked={contentSelectionInput.contentSelection.options.fullNovel.enabled}
			                                                    onChange={(e) => {
			                                                        const nextEnabled = e.target.checked
			                                                        updateSelectedInput((prev) => {
			                                                            if (prev.type !== 'content_selection') return prev
			                                                            return {
			                                                                ...prev,
			                                                                contentSelection: {
			                                                                    ...prev.contentSelection,
			                                                                    options: {
			                                                                        ...prev.contentSelection.options,
			                                                                        fullNovel: {
			                                                                            ...prev.contentSelection.options.fullNovel,
		                                                                            enabled: nextEnabled,
		                                                                        },
		                                                                    },
		                                                                },
		                                                            }
			                                                        })
			                                                        if (!nextEnabled) {
			                                                            handleUpdateContentSelectionPreviewState(
			                                                                contentSelectionInput.id,
			                                                                { selections: [] },
			                                                                (prev) => ({
			                                                                    ...prev,
			                                                                    selections: prev.selections.filter(
			                                                                        (selection) => selection.kind !== 'full_novel'
			                                                                    ),
			                                                                })
			                                                            )
			                                                        }
			                                                    }}
		                                                />
		                                                <div className="min-w-0 flex-1 flex items-center justify-between gap-3">
		                                                    <div className="flex items-center gap-2 min-w-0">
		                                                        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
		                                                            <BookOpen className="h-4 w-4 text-muted-foreground" />
		                                                        </div>
		                                                        <div className="text-sm font-medium truncate">
		                                                            {t('advanced.contentSelection.fullNovel')}
		                                                        </div>
		                                                    </div>
		                                                    <TreatAsSegment
		                                                        value={contentSelectionInput.contentSelection.options.fullNovel.treatAs}
		                                                        disabled={disabled || !contentSelectionInput.contentSelection.options.fullNovel.enabled}
		                                                        fullTextLabel={t('advanced.contentSelection.fullText')}
	                                                        summaryLabel={t('advanced.contentSelection.summary')}
	                                                        onChange={(next) =>
	                                                            updateSelectedInput((prev) => {
	                                                                if (prev.type !== 'content_selection') return prev
	                                                                return {
	                                                                    ...prev,
	                                                                    contentSelection: {
	                                                                        ...prev.contentSelection,
	                                                                        options: {
	                                                                            ...prev.contentSelection.options,
	                                                                            fullNovel: {
	                                                                                ...prev.contentSelection.options.fullNovel,
	                                                                                treatAs: next,
	                                                                            },
	                                                                        },
	                                                                    },
	                                                                }
	                                                            })
	                                                        }
	                                                    />
	                                                </div>
	                                            </div>

	                                            <div className="flex items-start gap-2">
	                                                <input
	                                                    type="checkbox"
	                                                    className="mt-1 h-4 w-4"
	                                                    disabled={disabled}
	                                                    checked={contentSelectionInput.contentSelection.options.act.enabled}
	                                                    onChange={(e) =>
	                                                        updateSelectedInput((prev) => {
	                                                            if (prev.type !== 'content_selection') return prev
	                                                            return {
	                                                                ...prev,
	                                                                contentSelection: {
	                                                                    ...prev.contentSelection,
	                                                                    options: {
	                                                                        ...prev.contentSelection.options,
	                                                                        act: {
	                                                                            ...prev.contentSelection.options.act,
	                                                                            enabled: e.target.checked,
	                                                                        },
	                                                                    },
	                                                                },
	                                                            }
	                                                        })
		                                                    }
		                                                />
		                                                <div className="min-w-0 flex-1 flex items-center justify-between gap-3">
		                                                    <div className="flex items-center gap-2 min-w-0">
		                                                        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
		                                                            <Folder className="h-4 w-4 text-muted-foreground" />
		                                                        </div>
		                                                        <div className="text-sm font-medium truncate">
		                                                            {t('advanced.contentSelection.act')}
		                                                        </div>
		                                                    </div>
		                                                    <TreatAsSegment
		                                                        value={contentSelectionInput.contentSelection.options.act.treatAs}
		                                                        disabled={disabled || !contentSelectionInput.contentSelection.options.act.enabled}
		                                                        fullTextLabel={t('advanced.contentSelection.fullText')}
	                                                        summaryLabel={t('advanced.contentSelection.summary')}
	                                                        onChange={(next) =>
	                                                            updateSelectedInput((prev) => {
	                                                                if (prev.type !== 'content_selection') return prev
	                                                                return {
	                                                                    ...prev,
	                                                                    contentSelection: {
	                                                                        ...prev.contentSelection,
	                                                                        options: {
	                                                                            ...prev.contentSelection.options,
	                                                                            act: {
	                                                                                ...prev.contentSelection.options.act,
	                                                                                treatAs: next,
	                                                                            },
	                                                                        },
	                                                                    },
	                                                                }
	                                                            })
	                                                        }
	                                                    />
	                                                </div>
	                                            </div>

	                                            <div className="flex items-start gap-2">
	                                                <input
	                                                    type="checkbox"
	                                                    className="mt-1 h-4 w-4"
	                                                    disabled={disabled}
	                                                    checked={contentSelectionInput.contentSelection.options.chapter.enabled}
	                                                    onChange={(e) =>
	                                                        updateSelectedInput((prev) => {
	                                                            if (prev.type !== 'content_selection') return prev
	                                                            return {
	                                                                ...prev,
	                                                                contentSelection: {
	                                                                    ...prev.contentSelection,
	                                                                    options: {
	                                                                        ...prev.contentSelection.options,
	                                                                        chapter: {
	                                                                            ...prev.contentSelection.options.chapter,
	                                                                            enabled: e.target.checked,
	                                                                        },
	                                                                    },
	                                                                },
	                                                            }
	                                                        })
		                                                    }
		                                                />
		                                                <div className="min-w-0 flex-1 flex items-center justify-between gap-3">
		                                                    <div className="flex items-center gap-2 min-w-0">
		                                                        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
		                                                            <FileText className="h-4 w-4 text-muted-foreground" />
		                                                        </div>
		                                                        <div className="text-sm font-medium truncate">
		                                                            {t('advanced.contentSelection.chapter')}
		                                                        </div>
		                                                    </div>
		                                                    <TreatAsSegment
		                                                        value={contentSelectionInput.contentSelection.options.chapter.treatAs}
		                                                        disabled={disabled || !contentSelectionInput.contentSelection.options.chapter.enabled}
		                                                        fullTextLabel={t('advanced.contentSelection.fullText')}
	                                                        summaryLabel={t('advanced.contentSelection.summary')}
	                                                        onChange={(next) =>
	                                                            updateSelectedInput((prev) => {
	                                                                if (prev.type !== 'content_selection') return prev
	                                                                return {
	                                                                    ...prev,
	                                                                    contentSelection: {
	                                                                        ...prev.contentSelection,
	                                                                        options: {
	                                                                            ...prev.contentSelection.options,
	                                                                            chapter: {
	                                                                                ...prev.contentSelection.options.chapter,
	                                                                                treatAs: next,
	                                                                            },
	                                                                        },
	                                                                    },
	                                                                }
	                                                            })
	                                                        }
	                                                    />
	                                                </div>
	                                            </div>

	                                            <div className="flex items-start gap-2">
	                                                <input
	                                                    type="checkbox"
	                                                    className="mt-1 h-4 w-4"
	                                                    disabled={disabled}
	                                                    checked={contentSelectionInput.contentSelection.options.scene.enabled}
	                                                    onChange={(e) =>
	                                                        updateSelectedInput((prev) => {
	                                                            if (prev.type !== 'content_selection') return prev
	                                                            return {
	                                                                ...prev,
	                                                                contentSelection: {
	                                                                    ...prev.contentSelection,
	                                                                    options: {
	                                                                        ...prev.contentSelection.options,
	                                                                        scene: {
	                                                                            ...prev.contentSelection.options.scene,
	                                                                            enabled: e.target.checked,
	                                                                        },
	                                                                    },
	                                                                },
	                                                            }
	                                                        })
		                                                    }
		                                                />
		                                                <div className="min-w-0 flex-1 flex items-center justify-between gap-3">
		                                                    <div className="flex items-center gap-2 min-w-0">
		                                                        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
		                                                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
		                                                        </div>
		                                                        <div className="text-sm font-medium truncate">
		                                                            {t('advanced.contentSelection.scene')}
		                                                        </div>
		                                                    </div>
		                                                    <TreatAsSegment
		                                                        value={contentSelectionInput.contentSelection.options.scene.treatAs}
		                                                        disabled={disabled || !contentSelectionInput.contentSelection.options.scene.enabled}
		                                                        fullTextLabel={t('advanced.contentSelection.fullText')}
	                                                        summaryLabel={t('advanced.contentSelection.summary')}
	                                                        onChange={(next) =>
	                                                            updateSelectedInput((prev) => {
	                                                                if (prev.type !== 'content_selection') return prev
	                                                                return {
	                                                                    ...prev,
	                                                                    contentSelection: {
	                                                                        ...prev.contentSelection,
	                                                                        options: {
	                                                                            ...prev.contentSelection.options,
	                                                                            scene: {
	                                                                                ...prev.contentSelection.options.scene,
	                                                                                treatAs: next,
	                                                                            },
	                                                                        },
	                                                                    },
	                                                                }
	                                                            })
	                                                        }
	                                                    />
	                                                </div>
	                                            </div>

			                                            <div className="flex items-start gap-2">
			                                                <input
			                                                    type="checkbox"
			                                                    className="mt-1 h-4 w-4"
		                                                    disabled={disabled}
		                                                    checked={contentSelectionInput.contentSelection.options.snippet.enabled}
		                                                    onChange={(e) =>
		                                                        updateSelectedInput((prev) => {
	                                                            if (prev.type !== 'content_selection') return prev
	                                                            return {
	                                                                ...prev,
	                                                                contentSelection: {
	                                                                    ...prev.contentSelection,
	                                                                    options: {
	                                                                        ...prev.contentSelection.options,
	                                                                        snippet: {
	                                                                            ...prev.contentSelection.options.snippet,
	                                                                            enabled: e.target.checked,
	                                                                        },
	                                                                    },
	                                                                },
	                                                            }
	                                                        })
		                                                    }
				                                                />
				                                                <div className="min-w-0 flex-1 flex items-center gap-2">
				                                                    <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
				                                                        <StickyNote className="h-4 w-4 text-muted-foreground" />
				                                                    </div>
				                                                    <div className="text-sm font-medium min-w-0 truncate">
				                                                        {t('advanced.contentSelection.snippet')}
				                                                    </div>
				                                                </div>
				                                            </div>

	                                            <div className="flex items-start gap-2">
	                                                <input
	                                                    type="checkbox"
	                                                    className="mt-1 h-4 w-4"
	                                                    disabled={disabled}
	                                                    checked={contentSelectionInput.contentSelection.options.term.enabled}
	                                                    onChange={(e) =>
	                                                        updateSelectedInput((prev) => {
	                                                            if (prev.type !== 'content_selection') return prev
	                                                            return {
	                                                                ...prev,
	                                                                contentSelection: {
	                                                                    ...prev.contentSelection,
	                                                                    options: {
	                                                                        ...prev.contentSelection.options,
	                                                                        term: {
	                                                                            ...prev.contentSelection.options.term,
	                                                                            enabled: e.target.checked,
	                                                                        },
	                                                                    },
	                                                                },
	                                                            }
	                                                        })
	                                                    }
			                                                />
			                                                <div className="min-w-0 flex-1 space-y-2">
			                                                    <div className="flex items-center gap-2 min-w-0">
			                                                        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
			                                                            <BookText className="h-4 w-4 text-muted-foreground" />
			                                                        </div>
			                                                        <div className="text-sm font-medium truncate">
			                                                            {t('advanced.contentSelection.term')}
			                                                        </div>
			                                                    </div>
			                                                    {contentSelectionInput.contentSelection.options.term.enabled && (
			                                                        <div className="grid gap-2 sm:grid-cols-2">
	                                                            <label
	                                                                className={cn(
	                                                                    'flex items-center gap-2 text-xs text-muted-foreground',
	                                                                    disabled && 'opacity-60'
	                                                                )}
	                                                            >
	                                                                <input
	                                                                    type="checkbox"
	                                                                    className="h-4 w-4"
	                                                                    disabled={disabled}
	                                                                    checked={
	                                                                        contentSelectionInput.contentSelection.options.term.allowedTypes
	                                                                            .characters
	                                                                    }
	                                                                    onChange={(e) =>
	                                                                        updateSelectedInput((prev) => {
	                                                                            if (prev.type !== 'content_selection') return prev
	                                                                            return {
	                                                                                ...prev,
	                                                                                contentSelection: {
	                                                                                    ...prev.contentSelection,
	                                                                                    options: {
	                                                                                        ...prev.contentSelection.options,
	                                                                                        term: {
	                                                                                            ...prev.contentSelection.options.term,
	                                                                                            allowedTypes: {
	                                                                                                ...prev.contentSelection.options.term.allowedTypes,
	                                                                                                characters: e.target.checked,
	                                                                                            },
	                                                                                        },
	                                                                                    },
	                                                                                },
	                                                                            }
	                                                                        })
	                                                                    }
	                                                                />
	                                                                <span className="inline-flex items-center gap-2">
	                                                                    <UserRound className="h-4 w-4 text-muted-foreground" />
	                                                                    {tTerms('categories.characters')}
	                                                                </span>
	                                                            </label>
	                                                            <label
	                                                                className={cn(
	                                                                    'flex items-center gap-2 text-xs text-muted-foreground',
	                                                                    disabled && 'opacity-60'
	                                                                )}
	                                                            >
	                                                                <input
	                                                                    type="checkbox"
	                                                                    className="h-4 w-4"
	                                                                    disabled={disabled}
	                                                                    checked={
	                                                                        contentSelectionInput.contentSelection.options.term.allowedTypes
	                                                                            .locations
	                                                                    }
	                                                                    onChange={(e) =>
	                                                                        updateSelectedInput((prev) => {
	                                                                            if (prev.type !== 'content_selection') return prev
	                                                                            return {
	                                                                                ...prev,
	                                                                                contentSelection: {
	                                                                                    ...prev.contentSelection,
	                                                                                    options: {
	                                                                                        ...prev.contentSelection.options,
	                                                                                        term: {
	                                                                                            ...prev.contentSelection.options.term,
	                                                                                            allowedTypes: {
	                                                                                                ...prev.contentSelection.options.term.allowedTypes,
	                                                                                                locations: e.target.checked,
	                                                                                            },
	                                                                                        },
	                                                                                    },
	                                                                                },
	                                                                            }
	                                                                        })
	                                                                    }
	                                                                />
	                                                                <span className="inline-flex items-center gap-2">
	                                                                    <MapPin className="h-4 w-4 text-muted-foreground" />
	                                                                    {tTerms('categories.locations')}
	                                                                </span>
	                                                            </label>
	                                                            <label
	                                                                className={cn(
	                                                                    'flex items-center gap-2 text-xs text-muted-foreground',
	                                                                    disabled && 'opacity-60'
	                                                                )}
	                                                            >
	                                                                <input
	                                                                    type="checkbox"
	                                                                    className="h-4 w-4"
	                                                                    disabled={disabled}
	                                                                    checked={contentSelectionInput.contentSelection.options.term.allowedTypes.items}
	                                                                    onChange={(e) =>
	                                                                        updateSelectedInput((prev) => {
	                                                                            if (prev.type !== 'content_selection') return prev
	                                                                            return {
	                                                                                ...prev,
	                                                                                contentSelection: {
	                                                                                    ...prev.contentSelection,
	                                                                                    options: {
	                                                                                        ...prev.contentSelection.options,
	                                                                                        term: {
	                                                                                            ...prev.contentSelection.options.term,
	                                                                                            allowedTypes: {
	                                                                                                ...prev.contentSelection.options.term.allowedTypes,
	                                                                                                items: e.target.checked,
	                                                                                            },
	                                                                                        },
	                                                                                    },
	                                                                                },
	                                                                            }
	                                                                        })
	                                                                    }
	                                                                />
	                                                                <span className="inline-flex items-center gap-2">
	                                                                    <Shapes className="h-4 w-4 text-muted-foreground" />
	                                                                    {tTerms('categories.items')}
	                                                                </span>
	                                                            </label>
	                                                            <label
	                                                                className={cn(
	                                                                    'flex items-center gap-2 text-xs text-muted-foreground',
	                                                                    disabled && 'opacity-60'
	                                                                )}
	                                                            >
	                                                                <input
	                                                                    type="checkbox"
	                                                                    className="h-4 w-4"
	                                                                    disabled={disabled}
	                                                                    checked={contentSelectionInput.contentSelection.options.term.allowedTypes.lore}
	                                                                    onChange={(e) =>
	                                                                        updateSelectedInput((prev) => {
	                                                                            if (prev.type !== 'content_selection') return prev
	                                                                            return {
	                                                                                ...prev,
	                                                                                contentSelection: {
	                                                                                    ...prev.contentSelection,
	                                                                                    options: {
	                                                                                        ...prev.contentSelection.options,
	                                                                                        term: {
	                                                                                            ...prev.contentSelection.options.term,
	                                                                                            allowedTypes: {
	                                                                                                ...prev.contentSelection.options.term.allowedTypes,
	                                                                                                lore: e.target.checked,
	                                                                                            },
	                                                                                        },
	                                                                                    },
	                                                                                },
	                                                                            }
	                                                                        })
	                                                                    }
	                                                                />
	                                                                <span className="inline-flex items-center gap-2">
	                                                                    <BookText className="h-4 w-4 text-muted-foreground" />
	                                                                    {tTerms('categories.lore')}
	                                                                </span>
	                                                            </label>
	                                                            <label
	                                                                className={cn(
	                                                                    'flex items-center gap-2 text-xs text-muted-foreground',
	                                                                    disabled && 'opacity-60'
	                                                                )}
	                                                            >
	                                                                <input
	                                                                    type="checkbox"
	                                                                    className="h-4 w-4"
	                                                                    disabled={disabled}
	                                                                    checked={contentSelectionInput.contentSelection.options.term.allowedTypes.others}
	                                                                    onChange={(e) =>
	                                                                        updateSelectedInput((prev) => {
	                                                                            if (prev.type !== 'content_selection') return prev
	                                                                            return {
	                                                                                ...prev,
	                                                                                contentSelection: {
	                                                                                    ...prev.contentSelection,
	                                                                                    options: {
	                                                                                        ...prev.contentSelection.options,
	                                                                                        term: {
	                                                                                            ...prev.contentSelection.options.term,
	                                                                                            allowedTypes: {
	                                                                                                ...prev.contentSelection.options.term.allowedTypes,
	                                                                                                others: e.target.checked,
	                                                                                            },
	                                                                                        },
	                                                                                    },
	                                                                                },
	                                                                            }
	                                                                        })
	                                                                    }
	                                                                />
	                                                                <span className="inline-flex items-center gap-2">
	                                                                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
	                                                                    {t('advanced.contentSelection.termOtherTypes')}
	                                                                </span>
	                                                            </label>
	                                                        </div>
	                                                    )}
	                                                </div>
	                                            </div>

	                                            <div className="flex items-start gap-2">
	                                                <input
	                                                    type="checkbox"
	                                                    className="mt-1 h-4 w-4"
	                                                    disabled={disabled}
	                                                    checked={contentSelectionInput.contentSelection.options.label.enabled}
	                                                    onChange={(e) =>
	                                                        updateSelectedInput((prev) => {
	                                                            if (prev.type !== 'content_selection') return prev
	                                                            return {
	                                                                ...prev,
	                                                                contentSelection: {
	                                                                    ...prev.contentSelection,
	                                                                    options: {
	                                                                        ...prev.contentSelection.options,
	                                                                        label: {
	                                                                            ...prev.contentSelection.options.label,
	                                                                            enabled: e.target.checked,
	                                                                        },
	                                                                    },
	                                                                },
	                                                            }
	                                                        })
	                                                    }
			                                                />
			                                                <div className="min-w-0 flex-1 space-y-2">
			                                                    <div className="flex items-center gap-2 min-w-0">
			                                                        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
			                                                            <Tag className="h-4 w-4 text-muted-foreground" />
			                                                        </div>
			                                                        <div className="text-sm font-medium truncate">
			                                                            {t('advanced.contentSelection.label')}
			                                                        </div>
			                                                    </div>
			                                                    {contentSelectionInput.contentSelection.options.label.enabled && (
			                                                        <div className="space-y-2">
	                                                            <div className="flex items-center justify-between gap-3">
	                                                                <div className="text-xs text-muted-foreground">
	                                                                    {t('advanced.contentSelection.act')}
	                                                                </div>
	                                                                <TreatAsSegment
	                                                                    value={
	                                                                        contentSelectionInput.contentSelection.options.label.actTreatAs
	                                                                    }
	                                                                    disabled={disabled}
	                                                                    fullTextLabel={t('advanced.contentSelection.fullText')}
	                                                                    summaryLabel={t('advanced.contentSelection.summary')}
	                                                                    onChange={(next) =>
	                                                                        updateSelectedInput((prev) => {
	                                                                            if (prev.type !== 'content_selection') return prev
	                                                                            return {
	                                                                                ...prev,
	                                                                                contentSelection: {
	                                                                                    ...prev.contentSelection,
	                                                                                    options: {
	                                                                                        ...prev.contentSelection.options,
	                                                                                        label: {
	                                                                                            ...prev.contentSelection.options.label,
	                                                                                            actTreatAs: next,
	                                                                                        },
	                                                                                    },
	                                                                                },
	                                                                            }
	                                                                        })
	                                                                    }
	                                                                />
	                                                            </div>
	                                                            <div className="flex items-center justify-between gap-3">
	                                                                <div className="text-xs text-muted-foreground">
	                                                                    {t('advanced.contentSelection.scene')}
	                                                                </div>
	                                                                <TreatAsSegment
	                                                                    value={
	                                                                        contentSelectionInput.contentSelection.options.label.sceneTreatAs
	                                                                    }
	                                                                    disabled={disabled}
	                                                                    fullTextLabel={t('advanced.contentSelection.fullText')}
	                                                                    summaryLabel={t('advanced.contentSelection.summary')}
	                                                                    onChange={(next) =>
	                                                                        updateSelectedInput((prev) => {
	                                                                            if (prev.type !== 'content_selection') return prev
	                                                                            return {
	                                                                                ...prev,
	                                                                                contentSelection: {
	                                                                                    ...prev.contentSelection,
	                                                                                    options: {
	                                                                                        ...prev.contentSelection.options,
	                                                                                        label: {
	                                                                                            ...prev.contentSelection.options.label,
	                                                                                            sceneTreatAs: next,
	                                                                                        },
	                                                                                    },
	                                                                                },
	                                                                            }
	                                                                        })
	                                                                    }
	                                                                />
	                                                            </div>
	                                                        </div>
	                                                    )}
	                                                </div>
	                                            </div>

		                                            <div className="flex items-start gap-2">
		                                                <input
		                                                    type="checkbox"
		                                                    className="mt-1 h-4 w-4"
		                                                    disabled={disabled}
		                                                    checked={contentSelectionInput.contentSelection.options.outline.enabled}
		                                                    onChange={(e) =>
		                                                        updateSelectedInput((prev) => {
		                                                            if (prev.type !== 'content_selection') return prev
		                                                            return {
		                                                                ...prev,
		                                                                contentSelection: {
		                                                                    ...prev.contentSelection,
		                                                                    options: {
		                                                                        ...prev.contentSelection.options,
		                                                                        outline: {
		                                                                            ...prev.contentSelection.options.outline,
		                                                                            enabled: e.target.checked,
		                                                                        },
		                                                                    },
		                                                                },
		                                                            }
		                                                        })
		                                                    }
		                                                />
		                                                <div className="min-w-0 flex-1 space-y-2">
		                                                    <div className="flex items-center gap-2 min-w-0">
		                                                        <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
		                                                            <ClipboardList className="h-4 w-4 text-muted-foreground" />
		                                                        </div>
		                                                        <div className="text-sm font-medium truncate">
		                                                            {t('advanced.contentSelection.outline')}
		                                                        </div>
		                                                    </div>

		                                                    {contentSelectionInput.contentSelection.options.outline.enabled && (
		                                                        <div className="flex flex-wrap items-center gap-4">
		                                                            <label
		                                                                className={cn(
		                                                                    'inline-flex items-center gap-2 text-xs text-muted-foreground',
		                                                                    disabled && 'opacity-60'
		                                                                )}
		                                                            >
		                                                                <input
		                                                                    type="checkbox"
		                                                                    className="h-4 w-4"
		                                                                    disabled={disabled}
		                                                                    checked={contentSelectionInput.contentSelection.options.outline.act.enabled}
		                                                                    onChange={(e) =>
		                                                                        updateSelectedInput((prev) => {
		                                                                            if (prev.type !== 'content_selection') return prev
		                                                                            return {
		                                                                                ...prev,
		                                                                                contentSelection: {
		                                                                                    ...prev.contentSelection,
		                                                                                    options: {
		                                                                                        ...prev.contentSelection.options,
		                                                                                        outline: {
		                                                                                            ...prev.contentSelection.options.outline,
		                                                                                            act: {
		                                                                                                ...prev.contentSelection.options.outline.act,
		                                                                                                enabled: e.target.checked,
		                                                                                            },
		                                                                                        },
		                                                                                    },
		                                                                                },
		                                                                            }
		                                                                        })
		                                                                    }
		                                                                />
		                                                                <span>{t('advanced.contentSelection.actOutline')}</span>
		                                                            </label>

		                                                            <label
		                                                                className={cn(
		                                                                    'inline-flex items-center gap-2 text-xs text-muted-foreground',
		                                                                    disabled && 'opacity-60'
		                                                                )}
		                                                            >
		                                                                <input
		                                                                    type="checkbox"
		                                                                    className="h-4 w-4"
		                                                                    disabled={disabled}
		                                                                    checked={
		                                                                        contentSelectionInput.contentSelection.options.outline.chapter.enabled
		                                                                    }
		                                                                    onChange={(e) =>
		                                                                        updateSelectedInput((prev) => {
		                                                                            if (prev.type !== 'content_selection') return prev
		                                                                            return {
		                                                                                ...prev,
		                                                                                contentSelection: {
		                                                                                    ...prev.contentSelection,
		                                                                                    options: {
		                                                                                        ...prev.contentSelection.options,
		                                                                                        outline: {
		                                                                                            ...prev.contentSelection.options.outline,
		                                                                                            chapter: {
		                                                                                                ...prev.contentSelection.options.outline.chapter,
		                                                                                                enabled: e.target.checked,
		                                                                                            },
		                                                                                        },
		                                                                                    },
		                                                                                },
		                                                                            }
		                                                                        })
		                                                                    }
		                                                                />
		                                                                <span>{t('advanced.contentSelection.chapterOutline')}</span>
		                                                            </label>
		                                                        </div>
		                                                    )}
		                                                </div>
		                                            </div>

		                                            <div className="flex items-start gap-2">
		                                                <input
		                                                    type="checkbox"
		                                                    className="mt-1 h-4 w-4"
		                                                    disabled={disabled}
		                                                    checked={contentSelectionInput.contentSelection.options.termTag.enabled}
		                                                    onChange={(e) =>
		                                                        updateSelectedInput((prev) => {
		                                                            if (prev.type !== 'content_selection') return prev
		                                                            return {
		                                                                ...prev,
		                                                                contentSelection: {
		                                                                    ...prev.contentSelection,
		                                                                    options: {
		                                                                        ...prev.contentSelection.options,
		                                                                        termTag: {
		                                                                            ...prev.contentSelection.options.termTag,
		                                                                            enabled: e.target.checked,
		                                                                        },
		                                                                    },
		                                                                },
		                                                            }
		                                                        })
		                                                    }
		                                                />
		                                                <div className="min-w-0 flex-1 flex items-center gap-2">
		                                                    <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center">
		                                                        <Bookmark className="h-4 w-4 text-muted-foreground" />
		                                                    </div>
		                                                    <div className="text-sm font-medium min-w-0 truncate">
		                                                        {t('advanced.contentSelection.termTag')}
		                                                    </div>
		                                                </div>
		                                            </div>

		                                            <Separator />

					                                            <div className="space-y-2">
					                                                <Label htmlFor={`prompt-input-display-name-${selectedInput.id}`}>
					                                                    {t('advanced.contentSelection.displayNameLabel')}
					                                                </Label>
					                                                <DisplayNameEditor
					                                                    key={selectedInput.id}
					                                                    id={`prompt-input-display-name-${selectedInput.id}`}
					                                                    disabled={disabled}
					                                                    baseName={contentSelectionInput.name.trim()}
					                                                    storedDisplayName={contentSelectionInput.contentSelection.displayName}
					                                                    untitledLabel={t('advanced.inputs.untitled')}
					                                                    onCommit={(raw) =>
					                                                        updateSelectedInput((prev) => {
					                                                            if (prev.type !== 'content_selection') return prev
					                                                            const trimmed = raw.trim()
					                                                            const base = prev.name.trim()
					                                                            const next =
					                                                                trimmed.length === 0 || (base && trimmed === base) ? '' : raw
					                                                            return {
					                                                                ...prev,
					                                                                contentSelection: { ...prev.contentSelection, displayName: next },
					                                                            }
					                                                        })
					                                                    }
					                                                />
					                                                <div className="text-xs text-muted-foreground">
					                                                    {t('advanced.contentSelection.displayNameHint')}
					                                                </div>
					                                            </div>
		                                        </div>
		                                    </div>
		                                )}
		                            </div>
		
			                            {customInput && (
		                                <>
		                                    <Separator />
	
	                                    <div className="space-y-2">
	                                <div className="space-y-1">
	                                    <div className="text-sm font-medium">{t('advanced.defaultContent.title')}</div>
	                                    <div className="text-xs text-muted-foreground">{t('advanced.defaultContent.hint')}</div>
	                                </div>

	                                <div className="rounded-md border bg-background p-3 space-y-3">
	                                    {defaultContentLayout === 'none' ? (
	                                        <div className="text-sm text-muted-foreground">{t('advanced.defaultContent.empty')}</div>
		                                    ) : defaultContentLayout === 'and' || defaultContentLayout === 'or' ? (
		                                        <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center">
			                                        {renderDefaultDropdownPicker()}
			                                        <div className="text-xs font-semibold text-muted-foreground text-center">
			                                            {defaultContentLayout === 'and'
			                                                ? t('advanced.defaultContent.and')
			                                                : t('advanced.defaultContent.or')}
			                                        </div>
			                                        <AutoResizeTextarea
			                                            disabled={disabled}
			                                            value={defaultContent.text}
			                                            rows={1}
			                                            onChange={(e) => handleDefaultTextChange(e.target.value)}
			                                            placeholder={defaultTextPlaceholder}
			                                            className="min-h-9 bg-muted/30 py-1 break-words"
			                                        />
		                                        </div>
		                                    ) : (
		                                        <>
			                                            {dropdownEnabled && renderDefaultDropdownPicker()}
		                                            {textEnabled && !dropdownEnabled && (
	                                                <AutoResizeTextarea
	                                                    disabled={disabled}
	                                                    value={defaultContent.text}
	                                                    rows={1}
	                                                    onChange={(e) => handleDefaultTextChange(e.target.value)}
	                                                    placeholder={defaultTextPlaceholder}
	                                                    className="min-h-9 bg-muted/30 py-1 break-words"
	                                                />
	                                            )}
	                                            {textEnabled && dropdownEnabled && (
	                                                <AutoResizeTextarea
	                                                    disabled={disabled}
	                                                    value={defaultContent.text}
	                                                    rows={1}
	                                                    onChange={(e) => handleDefaultTextChange(e.target.value)}
	                                                    placeholder={defaultTextPlaceholder}
	                                                    className="min-h-9 bg-muted/30 py-1 break-words"
	                                                />
	                                            )}
	                                        </>
	                                    )}
		                                </div>
	                            </div>
	                                </>
	                            )}
                        </>
                    )}
                </div>
    )
}
