'use client'

import type { InputsEditorProps } from '@/components/editor/prompt-inputs-editor/model'
import { useInputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import { InputsEditorView } from '@/components/editor/prompt-inputs-editor/view'

export type InputsEditorViewMode = 'full' | 'tweak' | 'preview'

export type InputsEditorComponentProps = InputsEditorProps & {
    previewMode?: InputsEditorViewMode
    hideContextScenePicker?: boolean
    hideAddMissingButton?: boolean
}

export function InputsEditor({
    previewMode = 'full',
    hideContextScenePicker = false,
    hideAddMissingButton = false,
    ...props
}: InputsEditorComponentProps) {
    const model = useInputsEditorModel(props)

    return (
        <InputsEditorView
            model={model}
            previewMode={previewMode}
            hideContextScenePicker={hideContextScenePicker}
            hideAddMissingButton={hideAddMissingButton}
        />
    )
}
