'use client'

import type { ContentSelectionTarget } from '@/lib/prompt-inputs'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    DropdownMenuCheckboxItem,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { Ban, Search } from 'lucide-react'
import { selectionKey } from '@/components/editor/prompt-inputs-editor/utils'
import type { PreviewContentSelectionSectionProps } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'

export function PreviewContentSelectionLabelSection({
    model,
    controller,
}: PreviewContentSelectionSectionProps) {
    const {
        t,
        ensureLabelsLoaded,
        labelPickerError,
        labelPickerItems,
        labelPickerLoading,
        labelPickerQuery,
        novelId,
        setLabelPickerQuery,
    } = model
    const { allowMultiple, enabled, state, selectedKeys, labelTreatSummary, addOrRemove, selectSingle, clearSelections } = controller

    return (
        <>
			                                                    {enabled.label.enabled && (
			                                                        <>
			                                                            <DropdownMenuSeparator />
			                                                            <DropdownMenuSub
			                                                                onOpenChange={(open) => {
			                                                                    if (!open) return
			                                                                    void ensureLabelsLoaded()
			                                                                    setLabelPickerQuery('')
			                                                                }}
			                                                            >
				                                                            <DropdownMenuSubTrigger disabled={!novelId}>
				                                                                    <div className="flex-1 flex items-center justify-between gap-2">
				                                                                        <span>{t('advanced.contentSelection.label')}</span>
				                                                                        <span className="text-xs text-muted-foreground">
				                                                                            {labelTreatSummary}
				                                                                        </span>
				                                                                    </div>
				                                                                </DropdownMenuSubTrigger>
				                                                                <DropdownMenuSubContent className="min-w-[320px]">
				                                                                    <div className="p-2">
				                                                                        <div className="relative">
			                                                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
			                                                                            <Input
			                                                                                value={labelPickerQuery}
			                                                                                onChange={(e) =>
			                                                                                    setLabelPickerQuery(e.target.value)
			                                                                                }
			                                                                                onKeyDown={(e) => e.stopPropagation()}
			                                                                                placeholder={t(
			                                                                                    'advanced.contentSelection.labelPicker.searchPlaceholder'
			                                                                                )}
			                                                                                className="pl-8 h-8 text-sm"
			                                                                            />
			                                                                        </div>
			                                                                    </div>

			                                                                    <DropdownMenuSeparator />

			                                                                    <ScrollArea className="h-[360px]">
			                                                                        <div className="p-1 space-y-1">
			                                                                            {labelPickerLoading ? (
			                                                                                <div className="px-2 py-6 text-sm text-muted-foreground text-center">
			                                                                                    {t(
			                                                                                        'advanced.contentSelection.labelPicker.loading'
			                                                                                    )}
			                                                                                </div>
			                                                                            ) : labelPickerError ? (
			                                                                                <div className="px-2 py-6 text-sm text-destructive text-center">
			                                                                                    {labelPickerError}
			                                                                                </div>
			                                                                            ) : labelPickerItems.length === 0 ? (
			                                                                                <div className="px-2 py-6 text-sm text-muted-foreground text-center">
			                                                                                    {t(
			                                                                                        'advanced.contentSelection.labelPicker.empty'
			                                                                                    )}
			                                                                                </div>
			                                                                            ) : (
			                                                                                labelPickerItems.map((label) => {
			                                                                                    const target: ContentSelectionTarget =
			                                                                                        {
			                                                                                            kind: 'label',
			                                                                                            labelId: label.id,
			                                                                                        }
			                                                                                    const key = selectionKey(target)
			                                                                                    const chipColor = label.color ?? '#000000'

			                                                                                    const labelNode = (
			                                                                                        <span className="flex items-center gap-2 min-w-0">
			                                                                                            <span
			                                                                                                className="inline-block h-3 w-3 rounded-sm border"
			                                                                                                style={{
			                                                                                                    backgroundColor: chipColor,
			                                                                                                    borderColor: chipColor,
			                                                                                                }}
			                                                                                                aria-hidden="true"
			                                                                                            />
			                                                                                            <span className="truncate">
			                                                                                                {label.name}
			                                                                                            </span>
			                                                                                        </span>
			                                                                                    )

			                                                                                    if (!allowMultiple) {
			                                                                                        return (
			                                                                                            <DropdownMenuItem
			                                                                                                key={key}
			                                                                                                onSelect={() =>
			                                                                                                    selectSingle(target)
			                                                                                                }
			                                                                                            >
			                                                                                                {labelNode}
			                                                                                            </DropdownMenuItem>
			                                                                                        )
			                                                                                    }

			                                                                                    return (
			                                                                                        <DropdownMenuCheckboxItem
			                                                                                            key={key}
			                                                                                            checked={selectedKeys.has(
			                                                                                                key
			                                                                                            )}
			                                                                                            onSelect={(e) =>
			                                                                                                e.preventDefault()
			                                                                                            }
			                                                                                            onCheckedChange={(next) =>
			                                                                                                addOrRemove(
			                                                                                                    target,
			                                                                                                    Boolean(next)
			                                                                                                )
			                                                                                            }
			                                                                                        >
			                                                                                            {labelNode}
			                                                                                        </DropdownMenuCheckboxItem>
			                                                                                    )
			                                                                                })
			                                                                            )}
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
