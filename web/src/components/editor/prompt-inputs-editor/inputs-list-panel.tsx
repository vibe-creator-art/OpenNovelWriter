'use client'

import { useRef, useState } from 'react'
import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowUpRight, GripVertical, Plus } from 'lucide-react'

export function InputsListPanel({ model }: { model: InputsEditorModel }) {
    const {
        t,
        disabled,
        handleAddInput,
        handleReorderInputs,
        value,
        importedInputs,
        effectiveSelectedInputId,
        usedInputIds,
        selectInput,
        navigateToPromptAdvanced,
    } = model
    const hasAnyInputs = value.length > 0 || importedInputs.length > 0
    const [draggedInputId, setDraggedInputId] = useState<string | null>(null)
    const [dropTargetInputId, setDropTargetInputId] = useState<string | null>(null)
    const justDraggedRef = useRef(false)

    return (
        <div className="rounded-md border bg-card">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
                <div className="text-sm font-medium">{t('advanced.inputs.title')}</div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={disabled}
                    onClick={handleAddInput}
                >
                    <Plus className="h-4 w-4" />
                    {t('advanced.inputs.add')}
                </Button>
            </div>

            <div
                className="p-2 space-y-1"
                onDragLeave={() => {
                    setDropTargetInputId(null)
                }}
            >
                {!hasAnyInputs ? (
                    <div className="px-2 py-6 text-sm text-muted-foreground text-center">{t('advanced.inputs.empty')}</div>
                ) : (
                    <>
                        {value.map((item) => {
                            const isSelected = item.id === effectiveSelectedInputId
                            const isUsed = usedInputIds.has(item.id)
                            return (
                                <div
                                    key={item.id}
                                    draggable={!disabled}
                                    className={cn(
                                        'rounded-md',
                                        dropTargetInputId === item.id && draggedInputId !== item.id && 'ring-2 ring-primary/35 ring-offset-2 ring-offset-background',
                                        draggedInputId === item.id && 'opacity-50'
                                    )}
                                    onDragStart={(event) => {
                                        if (disabled) {
                                            event.preventDefault()
                                            return
                                        }
                                        event.dataTransfer.effectAllowed = 'move'
                                        event.dataTransfer.setData('text/plain', item.id)
                                        setDraggedInputId(item.id)
                                        setDropTargetInputId(null)
                                    }}
                                    onDragOver={(event) => {
                                        if (disabled || draggedInputId === item.id) return
                                        event.preventDefault()
                                        event.dataTransfer.dropEffect = 'move'
                                        setDropTargetInputId(item.id)
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault()
                                        const activeId = draggedInputId
                                        if (!activeId || activeId === item.id) {
                                            setDropTargetInputId(null)
                                            return
                                        }
                                        handleReorderInputs(activeId, item.id)
                                        selectInput(activeId)
                                        setDropTargetInputId(null)
                                        justDraggedRef.current = true
                                        requestAnimationFrame(() => {
                                            justDraggedRef.current = false
                                        })
                                    }}
                                    onDragEnd={() => {
                                        setDraggedInputId(null)
                                        setDropTargetInputId(null)
                                    }}
                                >
                                    <button
                                        type="button"
                                        className={cn(
                                            'w-full text-left rounded-md border px-3 py-2 transition-colors',
                                            isSelected ? 'bg-muted ring-1 ring-primary/40' : 'hover:bg-muted/50'
                                        )}
                                        onClick={() => {
                                            if (justDraggedRef.current) return
                                            selectInput(item.id)
                                        }}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 items-start gap-2">
                                                <GripVertical
                                                    className={cn(
                                                        'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70',
                                                        disabled ? 'opacity-40' : 'cursor-grab'
                                                    )}
                                                />
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-medium">
                                                        {item.name.trim() || t('advanced.inputs.untitled')}
                                                    </div>
                                                    {item.description?.trim() && (
                                                        <div className="truncate text-xs text-muted-foreground">{item.description}</div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {item.collapsed && (
                                                    <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                                                        {t('advanced.inputs.collapsed')}
                                                    </span>
                                                )}
                                                {!isUsed && (
                                                    <span className="inline-flex items-center rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-300">
                                                        {t('advanced.inputs.unusedBadge')}
                                                    </span>
                                                )}
                                                {item.required && (
                                                    <span className="text-xs text-destructive">{t('advanced.inputs.requiredBadge')}</span>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            )
                        })}

                        {importedInputs.length > 0 && (
                            <div className="pt-2">
                                <div className="rounded-md border border-dashed bg-muted/10 p-1">
                                    <div className="px-2 py-1 text-xs text-muted-foreground">
                                        {t('advanced.inputs.includedTitle')}
                                    </div>
                                    <div className="space-y-1 p-1">
                                        {importedInputs.map((item) => {
                                            const input = item.input
                                            const isSelected = input.id === effectiveSelectedInputId
                                            const isUsed = usedInputIds.has(input.id)
                                            return (
                                                <div
                                                    key={`${item.sourcePrompt.id}:${input.id}`}
                                                    className={cn(
                                                        'w-full cursor-pointer rounded-md border px-3 py-2 transition-colors',
                                                        'opacity-70',
                                                        isSelected ? 'bg-muted ring-1 ring-primary/40' : 'hover:bg-muted/40'
                                                    )}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => selectInput(input.id)}
                                                    onKeyDown={(event) => {
                                                        if (event.key !== 'Enter' && event.key !== ' ') return
                                                        event.preventDefault()
                                                        selectInput(input.id)
                                                    }}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <div className="w-full text-left">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="truncate text-sm font-medium">
                                                                        {input.name.trim() || t('advanced.inputs.untitled')}
                                                                    </div>
                                                                    <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                                                                        {t('advanced.inputs.includedBadge')}
                                                                    </span>
                                                                </div>
                                                                <div className="truncate text-xs text-muted-foreground">
                                                                    {t('advanced.inputs.includedFrom', { name: item.sourcePrompt.name })}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="flex shrink-0 items-center gap-2">
                                                            {input.collapsed && (
                                                                <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                                                                    {t('advanced.inputs.collapsed')}
                                                                </span>
                                                            )}
                                                            {!isUsed && (
                                                                <span className="inline-flex items-center rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-300">
                                                                    {t('advanced.inputs.unusedBadge')}
                                                                </span>
                                                            )}
                                                            {input.required && (
                                                                <span className="text-xs text-destructive">{t('advanced.inputs.requiredBadge')}</span>
                                                            )}
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon-sm"
                                                                className="h-7 w-7"
                                                                title={t('advanced.inputs.jumpToSourceButton')}
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    navigateToPromptAdvanced({
                                                                        promptId: item.sourcePrompt.id,
                                                                        inputId: input.id,
                                                                    })
                                                                }}
                                                            >
                                                                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
