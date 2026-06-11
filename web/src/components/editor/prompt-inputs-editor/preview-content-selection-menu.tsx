'use client'

import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Ban, Plus } from 'lucide-react'
import type { PreviewContentSelectionSectionProps } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'
import { PreviewContentSelectionLibrarySections } from '@/components/editor/prompt-inputs-editor/preview-content-selection-library-sections'
import { PreviewContentSelectionMetadataSections } from '@/components/editor/prompt-inputs-editor/preview-content-selection-metadata-sections'
import { PreviewContentSelectionStructureSections } from '@/components/editor/prompt-inputs-editor/preview-content-selection-structure-sections'

export function PreviewContentSelectionMenu({
    input,
    model,
    controller,
}: PreviewContentSelectionSectionProps) {
    const { t } = model
    const { buttonLabel, state, clearSelections } = controller

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Plus className="h-4 w-4" />
                    <span className="truncate max-w-[220px]">{buttonLabel}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[280px]">
                <PreviewContentSelectionStructureSections input={input} model={model} controller={controller} />
                <PreviewContentSelectionLibrarySections input={input} model={model} controller={controller} />
                <PreviewContentSelectionMetadataSections input={input} model={model} controller={controller} />

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
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
