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
import { getSnippetDisplayTitle, htmlToText, selectionKey } from '@/components/editor/prompt-inputs-editor/utils'
import type { PreviewContentSelectionSectionProps } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'

export function PreviewContentSelectionSnippetSection({
    model,
    controller,
}: PreviewContentSelectionSectionProps) {
    const {
        t,
        ensureSnippetsLoaded,
        novelId,
        setSnippetPickerQuery,
        snippetPickerError,
        snippetPickerItems,
        snippetPickerLoading,
        snippetPickerQuery,
    } = model
    const { allowMultiple, enabled, state, selectedKeys, addOrRemove, selectSingle, clearSelections } = controller

    return (
        <>
			                                                    {enabled.snippet.enabled && (
			                                                        <>
			                                                            <DropdownMenuSeparator />
			                                                            <DropdownMenuSub
			                                                                onOpenChange={(open) => {
			                                                                    if (!open) return
			                                                                    ensureSnippetsLoaded({ resetQuery: true })
			                                                                }}
			                                                            >
		                                                                <DropdownMenuSubTrigger disabled={!novelId}>
		                                                                    {t('advanced.contentSelection.snippet')}
		                                                                </DropdownMenuSubTrigger>
		                                                                <DropdownMenuSubContent className="min-w-[360px]">
		                                                                    <div className="p-2">
		                                                                        <div className="relative">
		                                                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
		                                                                            <Input
		                                                                                value={snippetPickerQuery}
		                                                                                onChange={(e) => setSnippetPickerQuery(e.target.value)}
		                                                                                placeholder={t(
		                                                                                    'advanced.contentSelection.snippetPicker.searchPlaceholder'
		                                                                                )}
		                                                                                className="pl-8 h-8 text-sm"
		                                                                            />
		                                                                        </div>
		                                                                    </div>
		
		                                                                    <DropdownMenuSeparator />
		
		                                                                    <ScrollArea className="h-[360px]">
		                                                                        <div className="p-1 space-y-1">
		                                                                            {snippetPickerLoading ? (
		                                                                                <div className="px-2 py-6 text-sm text-muted-foreground text-center">
		                                                                                    {t(
		                                                                                        'advanced.contentSelection.snippetPicker.loading'
		                                                                                    )}
		                                                                                </div>
		                                                                            ) : snippetPickerError ? (
		                                                                                <div className="px-2 py-6 text-sm text-destructive text-center">
		                                                                                    {snippetPickerError}
		                                                                                </div>
		                                                                            ) : snippetPickerItems.length === 0 ? (
		                                                                                <div className="px-2 py-6 text-sm text-muted-foreground text-center">
		                                                                                    {t(
		                                                                                        'advanced.contentSelection.snippetPicker.empty'
		                                                                                    )}
		                                                                                </div>
		                                                                            ) : (
		                                                                                snippetPickerItems.map((snippet) => {
		                                                                                    const target: ContentSelectionTarget = {
		                                                                                        kind: 'snippet',
		                                                                                        snippetId: snippet.id,
		                                                                                    }
		                                                                                    const key = selectionKey(target)
		                                                                                    const displayTitle = getSnippetDisplayTitle(
		                                                                                        snippet,
		                                                                                        t(
		                                                                                            'advanced.contentSelection.snippetPicker.untitledSnippet'
		                                                                                        )
		                                                                                    )
		                                                                                    const excerpt = htmlToText(snippet.content)
		                                                                                        .trim()
		                                                                                        .replace(/\s+/g, ' ')
		                                                                                        .slice(0, 120)
		
		                                                                                    if (!allowMultiple) {
		                                                                                        return (
		                                                                                            <DropdownMenuItem
		                                                                                                key={key}
		                                                                                                className="items-start py-2"
		                                                                                                onSelect={() => selectSingle(target)}
		                                                                                            >
		                                                                                                <div className="min-w-0 flex-1 space-y-1">
		                                                                                                    <div className="flex items-center justify-between gap-2">
		                                                                                                        <div className="truncate text-sm font-medium">
		                                                                                                            {displayTitle}
		                                                                                                        </div>
		                                                                                                        {snippet.pinned && (
		                                                                                                            <div className="text-xs text-muted-foreground">
		                                                                                                                {t(
		                                                                                                                    'advanced.contentSelection.snippetPicker.pinned'
		                                                                                                                )}
		                                                                                                            </div>
		                                                                                                        )}
		                                                                                                    </div>
		                                                                                                    {excerpt && (
		                                                                                                        <div className="truncate text-xs text-muted-foreground">
		                                                                                                            {excerpt}
		                                                                                                        </div>
		                                                                                                    )}
		                                                                                                </div>
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
		                                                                                            <div className="min-w-0 flex-1 space-y-1">
		                                                                                                <div className="flex items-center justify-between gap-2">
		                                                                                                    <div className="truncate text-sm font-medium">
		                                                                                                        {displayTitle}
		                                                                                                    </div>
		                                                                                                    {snippet.pinned && (
		                                                                                                        <div className="text-xs text-muted-foreground">
		                                                                                                            {t(
		                                                                                                                'advanced.contentSelection.snippetPicker.pinned'
		                                                                                                            )}
		                                                                                                        </div>
		                                                                                                    )}
		                                                                                                </div>
		                                                                                                {excerpt && (
		                                                                                                    <div className="truncate text-xs text-muted-foreground">
		                                                                                                        {excerpt}
		                                                                                                    </div>
		                                                                                                )}
		                                                                                            </div>
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
