'use client'

import type { PreviewContentSelectionSectionProps } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'
import { PreviewContentSelectionSnippetSection } from '@/components/editor/prompt-inputs-editor/preview-content-selection-snippet-section'
import { PreviewContentSelectionTermSection } from '@/components/editor/prompt-inputs-editor/preview-content-selection-term-section'

export function PreviewContentSelectionLibrarySections(props: PreviewContentSelectionSectionProps) {
    return (
        <>
            <PreviewContentSelectionSnippetSection {...props} />
            <PreviewContentSelectionTermSection {...props} />
        </>
    )
}
