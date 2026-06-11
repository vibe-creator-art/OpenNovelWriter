'use client'

import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import type { PromptCheckboxInputDefinition } from '@/lib/prompt-inputs'
import { PreviewInputCardFrame } from '@/components/editor/prompt-inputs-editor/preview-input-card-frame'

export function PreviewCheckboxInputCard({
    input,
    model,
}: {
    input: PromptCheckboxInputDefinition
    model: InputsEditorModel
}) {
    const { t, checkboxPreviewCheckedByInputId, setCheckboxPreviewCheckedByInputId } = model
    const title = input.name.trim() || t('advanced.inputs.untitled')
    const description = input.description?.trim() ? input.description : null
    const checked = checkboxPreviewCheckedByInputId[input.id] ?? input.checkbox.defaultChecked
    const label = input.checkbox.displayName.trim() || input.name.trim() || t('advanced.inputs.untitled')

    return (
        <PreviewInputCardFrame
            key={`${input.id}:${input.collapsed ? 'collapsed' : 'expanded'}`}
            title={title}
            description={description}
            required={input.required}
            requiredLabel={t('advanced.inputs.requiredBadge')}
            collapsible={input.collapsed}
            expandLabel={t('advanced.inputs.expand')}
            collapseLabel={t('advanced.inputs.collapse')}
        >
            <label className="flex items-center gap-2 rounded-md bg-muted/20 px-3 py-2 text-sm">
                <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked}
                    onChange={(e) =>
                        setCheckboxPreviewCheckedByInputId((prev) => ({
                            ...prev,
                            [input.id]: e.target.checked,
                        }))
                    }
                />
                <span className="min-w-0 truncate">{label}</span>
            </label>
        </PreviewInputCardFrame>
    )
}
