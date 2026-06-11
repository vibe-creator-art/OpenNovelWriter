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

export function PreviewContentSelectionTermTagSection({
    model,
    controller,
}: PreviewContentSelectionSectionProps) {
    const {
        t,
        novelId,
        setTermTagPickerQuery,
        termTagPickerItems,
        termTagPickerQuery,
    } = model
    const { allowMultiple, enabled, state, selectedKeys, addOrRemove, selectSingle, clearSelections } = controller

    return (
        <>
			                                                    {enabled.termTag.enabled && (
			                                                        <>
			                                                            <DropdownMenuSeparator />
			                                                            <DropdownMenuSub
			                                                                onOpenChange={(open) => {
			                                                                    if (!open) return
			                                                                    setTermTagPickerQuery('')
			                                                                }}
			                                                            >
			                                                                <DropdownMenuSubTrigger disabled={!novelId}>
			                                                                    <span>{t('advanced.contentSelection.termTag')}</span>
			                                                                </DropdownMenuSubTrigger>
			                                                                <DropdownMenuSubContent className="min-w-[320px]">
			                                                                    <div className="p-2">
			                                                                        <div className="relative">
			                                                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
			                                                                            <Input
			                                                                                value={termTagPickerQuery}
			                                                                                onChange={(e) =>
			                                                                                    setTermTagPickerQuery(e.target.value)
			                                                                                }
			                                                                                onKeyDown={(e) => e.stopPropagation()}
			                                                                                placeholder={t(
			                                                                                    'advanced.contentSelection.termTagPicker.searchPlaceholder'
			                                                                                )}
			                                                                                className="pl-8 h-8 text-sm"
			                                                                            />
			                                                                        </div>
			                                                                    </div>

			                                                                    <DropdownMenuSeparator />

			                                                                    <ScrollArea className="h-[360px]">
			                                                                        <div className="p-1 space-y-1">
			                                                                            {termTagPickerItems.length === 0 ? (
			                                                                                <div className="px-2 py-6 text-sm text-muted-foreground text-center">
			                                                                                    {t(
			                                                                                        'advanced.contentSelection.termTagPicker.empty'
			                                                                                    )}
			                                                                                </div>
			                                                                            ) : (
			                                                                                termTagPickerItems.map((tag) => {
			                                                                                    const target: ContentSelectionTarget = {
			                                                                                        kind: 'term_tag',
			                                                                                        tag,
			                                                                                    }
			                                                                                    const key = selectionKey(target)
			                                                                                    const labelNode = (
			                                                                                        <span className="truncate">
			                                                                                            {tag}
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
			                                                                                            checked={selectedKeys.has(key)}
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
