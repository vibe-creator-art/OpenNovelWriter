'use client'

import { useRef, useState } from 'react'
import type { ContentSelectionTreatAs, PromptDropdownOption } from '@/lib/prompt-inputs'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GripVertical, MessageSquare, Trash2 } from 'lucide-react'
import type { TranslationFn } from '@/components/editor/prompt-inputs-editor/types'
import { getOptionColorDotStyle } from '@/components/editor/prompt-inputs-editor/utils'

export function SortableOptionRow({
    option,
    disabled,
    onEdit,
    onDelete,
    t,
}: {
    option: PromptDropdownOption
    disabled: boolean
    onEdit: () => void
    onDelete: () => void
    t: TranslationFn
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: option.id,
        disabled,
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    const hasDetails = Boolean((option.description ?? '').trim() || (option.content ?? '').trim() || option.color)
    const selectedColorStyle = getOptionColorDotStyle(option.color)

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'flex items-center gap-2 rounded-md border bg-card px-2 py-2',
                isDragging && 'opacity-70 ring-2 ring-primary/30'
            )}
        >
            <button
                type="button"
                className={cn('p-1 rounded hover:bg-muted', disabled && 'cursor-not-allowed opacity-60')}
                aria-label={t('advanced.dropdown.reorder')}
                disabled={disabled}
                {...attributes}
                {...listeners}
            >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
            </button>

            {selectedColorStyle && (
                <span className="h-4 w-4 rounded-full border shrink-0" style={selectedColorStyle} aria-hidden="true" />
            )}

            <button
                type="button"
                className={cn(
                    'flex-1 min-w-0 text-left rounded-md px-2 py-1 hover:bg-muted/50',
                    disabled && 'cursor-not-allowed opacity-60'
                )}
                disabled={disabled}
                onClick={onEdit}
                title={t('advanced.dropdown.editAdvanced')}
            >
                <div className="truncate text-sm">{option.label.trim() || t('advanced.dropdown.untitledOption')}</div>
            </button>

            <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className={cn('shrink-0', hasDetails && 'border-primary/40')}
                title={t('advanced.dropdown.editAdvanced')}
                disabled={disabled}
                onClick={onEdit}
            >
                <MessageSquare className="h-4 w-4" />
            </Button>

            <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="shrink-0"
                title={t('advanced.dropdown.deleteOption')}
                disabled={disabled}
                onClick={onDelete}
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    )
}

export function TreatAsSegment({
    value,
    disabled,
    onChange,
    fullTextLabel,
    summaryLabel,
}: {
    value: ContentSelectionTreatAs
    disabled: boolean
    onChange: (value: ContentSelectionTreatAs) => void
    fullTextLabel: string
    summaryLabel: string
}) {
    return (
        <div className={cn('inline-flex rounded-md border overflow-hidden', disabled && 'opacity-60')}>
            <button
                type="button"
                disabled={disabled}
                className={cn(
                    'px-3 py-1 text-xs font-medium transition-colors',
                    value === 'full_text' ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'
                )}
                onClick={() => onChange('full_text')}
            >
                {fullTextLabel}
            </button>
            <button
                type="button"
                disabled={disabled}
                className={cn(
                    'px-3 py-1 text-xs font-medium transition-colors border-l',
                    value === 'summary' ? 'bg-foreground text-background' : 'bg-background text-foreground hover:bg-muted'
                )}
                onClick={() => onChange('summary')}
            >
                {summaryLabel}
            </button>
        </div>
    )
}

export function DisplayNameEditor({
    id,
    disabled,
    baseName,
    storedDisplayName,
    untitledLabel,
    onCommit,
}: {
    id: string
    disabled: boolean
    baseName: string
    storedDisplayName: string
    untitledLabel: string
    onCommit: (raw: string) => void
}) {
    const [isEditing, setIsEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const skipNextBlurRef = useRef(false)

    const isDefault = storedDisplayName.trim().length === 0 || (baseName && storedDisplayName.trim() === baseName)
    const effective = isDefault ? baseName : storedDisplayName
    const displayText = effective || baseName || untitledLabel
    const placeholder = baseName || untitledLabel

    const commitAndClose = (raw: string) => {
        onCommit(raw)
        setIsEditing(false)
        setDraft('')
    }

    if (!isEditing) {
        return (
            <button
                type="button"
                id={id}
                disabled={disabled}
                className={cn(
                    'w-full rounded-md bg-muted/30 px-3 py-2 text-left text-sm border border-transparent',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    disabled && 'opacity-60 cursor-not-allowed'
                )}
                onClick={() => {
                    if (disabled) return
                    setDraft(isDefault ? '' : storedDisplayName)
                    setIsEditing(true)
                }}
            >
                <span className={cn('block truncate', isDefault ? 'text-muted-foreground' : 'text-foreground')}>
                    {displayText}
                </span>
            </button>
        )
    }

    return (
        <Input
            id={id}
            disabled={disabled}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault()
                    skipNextBlurRef.current = true
                    commitAndClose(draft)
                }
            }}
            onBlur={() => {
                if (skipNextBlurRef.current) {
                    skipNextBlurRef.current = false
                    return
                }
                commitAndClose(draft)
            }}
            autoFocus
            className="bg-muted/30 border-transparent shadow-none focus-visible:ring-0 focus-visible:border-ring/40"
        />
    )
}
