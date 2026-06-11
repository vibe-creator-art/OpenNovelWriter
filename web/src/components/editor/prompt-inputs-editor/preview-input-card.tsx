'use client'

import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import type { PromptInputDefinition } from '@/lib/prompt-inputs'
import { PreviewCheckboxInputCard } from '@/components/editor/prompt-inputs-editor/preview-checkbox-input-card'
import { PreviewContentSelectionInputCard } from '@/components/editor/prompt-inputs-editor/preview-content-selection-input-card'
import { PreviewCustomInputCard } from '@/components/editor/prompt-inputs-editor/preview-custom-input-card'

export function PreviewInputCard({
    input,
    model,
}: {
    input: PromptInputDefinition
    model: InputsEditorModel
}) {
    if (input.type === 'checkbox') {
        return <PreviewCheckboxInputCard input={input} model={model} />
    }

    if (input.type === 'custom') {
        return <PreviewCustomInputCard input={input} model={model} />
    }

    return <PreviewContentSelectionInputCard input={input} model={model} />
}
