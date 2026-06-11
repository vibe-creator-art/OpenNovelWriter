'use client'

import type { PreviewContentSelectionSectionProps } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'
import { PreviewContentSelectionLabelSection } from '@/components/editor/prompt-inputs-editor/preview-content-selection-label-section'
import { PreviewContentSelectionOutlineSection } from '@/components/editor/prompt-inputs-editor/preview-content-selection-outline-section'
import { PreviewContentSelectionTermTagSection } from '@/components/editor/prompt-inputs-editor/preview-content-selection-term-tag-section'

export function PreviewContentSelectionMetadataSections(props: PreviewContentSelectionSectionProps) {
    return (
        <>
            <PreviewContentSelectionLabelSection {...props} />
            <PreviewContentSelectionOutlineSection {...props} />
            <PreviewContentSelectionTermTagSection {...props} />
        </>
    )
}
