'use client'

import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import { AdvancedDropdownOptionDialog } from '@/components/editor/prompt-inputs-editor/advanced-dropdown-option-dialog'
import { EditorPanel } from '@/components/editor/prompt-inputs-editor/editor-panel'
import { InputsListPanel } from '@/components/editor/prompt-inputs-editor/inputs-list-panel'
import { PreviewPanel } from '@/components/editor/prompt-inputs-editor/preview-panel'

type InputsEditorViewProps = {
    model: InputsEditorModel
    previewMode?: 'full' | 'tweak' | 'preview'
    hideContextScenePicker?: boolean
    hideAddMissingButton?: boolean
}

export function InputsEditorView({
    model,
    previewMode = 'full',
    hideContextScenePicker = false,
    hideAddMissingButton = false,
}: InputsEditorViewProps) {
    return (
        <>
            <div className="grid gap-4 xl:grid-cols-[320px_minmax(460px,1fr)_minmax(360px,1fr)]">
                <InputsListPanel model={model} />
                <EditorPanel model={model} />
                <PreviewPanel
                    model={model}
                    mode={previewMode}
                    hideContextScenePicker={hideContextScenePicker}
                    hideAddMissingButton={hideAddMissingButton}
                />
            </div>

            <AdvancedDropdownOptionDialog model={model} />
        </>
    )
}
