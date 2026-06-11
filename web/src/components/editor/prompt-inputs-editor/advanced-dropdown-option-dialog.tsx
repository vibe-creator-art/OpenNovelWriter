'use client'

import { useEffect, useRef } from 'react'
import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import { PromptTemplateEditor } from '@/components/editor/prompts/prompt-template-editor'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Ban } from 'lucide-react'
import { OPTION_COLOR_PALETTE, getOptionColorCardStyle, getOptionColorDotStyle } from '@/components/editor/prompt-inputs-editor/utils'

export function AdvancedDropdownOptionDialog({ model }: { model: InputsEditorModel }) {
    const { editingOptionId, setEditingOptionId, editingOption, t, disabled, updateOption } = model
    const labelInputRef = useRef<HTMLInputElement | null>(null)
    const editingOptionReady = Boolean(editingOptionId && editingOption)

    useEffect(() => {
        if (!editingOptionId || !editingOptionReady) return

        const frame = requestAnimationFrame(() => {
            const input = labelInputRef.current
            if (!input || disabled) return

            input.focus()

            const isFreshOption = input.value.trim() === t('advanced.dropdown.newOptionLabel').trim()
            if (isFreshOption) {
                input.select()
                return
            }

            const caret = input.value.length
            input.setSelectionRange(caret, caret)
        })

        return () => cancelAnimationFrame(frame)
    }, [disabled, editingOptionId, editingOptionReady, t])

    return (
        <Dialog
            open={Boolean(editingOptionId)}
            onOpenChange={(open) => {
                if (!open) setEditingOptionId(null)
            }}
        >
            <DialogContent
                className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-4xl"
                onOpenAutoFocus={(event) => {
                    event.preventDefault()
                }}
            >
                <DialogHeader>
                    <DialogTitle>{t('advanced.dropdown.advancedTitle')}</DialogTitle>
                    <DialogDescription>{t('advanced.dropdown.advancedHint')}</DialogDescription>
                </DialogHeader>

                {!editingOption ? (
                    <div className="text-sm text-muted-foreground">{t('advanced.dropdown.optionNotFound')}</div>
                ) : (
                    <div className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
                        <div className="space-y-2">
                            <Label htmlFor="prompt-option-label">{t('advanced.dropdown.optionLabel')}</Label>
                            <Input
                                id="prompt-option-label"
                                ref={labelInputRef}
                                disabled={disabled}
                                value={editingOption.label}
                                onChange={(e) =>
                                    updateOption(editingOption.id, (prev) => ({
                                        ...prev,
                                        label: e.target.value,
                                    }))
                                }
                                placeholder={t('advanced.dropdown.optionLabelPlaceholder')}
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <Label>{t('advanced.dropdown.colorLabel')}</Label>

                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    className="shrink-0"
                                    title={t('advanced.dropdown.clearColor')}
                                    disabled={disabled || !editingOption.color}
                                    onClick={() =>
                                        updateOption(editingOption.id, (prev) => ({
                                            ...prev,
                                            color: null,
                                        }))
                                    }
                                >
                                    <Ban className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="grid grid-cols-6 gap-1.5 p-1">
                                {OPTION_COLOR_PALETTE.map((item) => {
                                    const isSelected = editingOption.color === item.id
                                    const cardStyle = getOptionColorCardStyle(item.id, { selected: isSelected })
                                    const dotStyle = getOptionColorDotStyle(item.id)
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            disabled={disabled}
                                            onClick={() =>
                                                updateOption(editingOption.id, (prev) => ({
                                                    ...prev,
                                                    color: item.id,
                                                }))
                                            }
                                            aria-label={t('advanced.dropdown.setColor', { color: item.label })}
                                            title={t('advanced.dropdown.setColor', { color: `${item.label} · ${item.hex}` })}
                                            className={cn(
                                                'flex h-8 items-center justify-center rounded-md border transition-colors',
                                                disabled && 'opacity-60 cursor-not-allowed',
                                                isSelected
                                                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                                                    : 'hover:border-foreground/20 hover:bg-muted/40'
                                            )}
                                            style={cardStyle}
                                        >
                                            <span className="h-4 w-4 rounded-full border" style={dotStyle} aria-hidden="true" />
                                        </button>
                                    )
                                })}
                            </div>

                            <div className="text-xs text-muted-foreground">{t('advanced.dropdown.colorHint')}</div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="prompt-option-desc">{t('advanced.dropdown.optionDescription')}</Label>
                            <Input
                                id="prompt-option-desc"
                                disabled={disabled}
                                value={editingOption.description ?? ''}
                                onChange={(e) =>
                                    updateOption(editingOption.id, (prev) => ({
                                        ...prev,
                                        description: e.target.value.trim() ? e.target.value : null,
                                    }))
                                }
                                placeholder={t('advanced.dropdown.optionDescriptionPlaceholder')}
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <Label>{t('advanced.dropdown.optionContent')}</Label>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={disabled}
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(editingOption.content ?? '')
                                        } catch (e) {
                                            console.error(e)
                                        }
                                    }}
                                >
                                    {t('advanced.dropdown.copyContent')}
                                </Button>
                            </div>

                            <PromptTemplateEditor
                                value={editingOption.content}
                                disabled={disabled}
                                onChange={(content) =>
                                    updateOption(editingOption.id, (prev) => ({
                                        ...prev,
                                        content,
                                    }))
                                }
                                className="h-[420px] max-h-[50vh]"
                                placeholder={t('advanced.dropdown.optionContentPlaceholder')}
                            />
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
