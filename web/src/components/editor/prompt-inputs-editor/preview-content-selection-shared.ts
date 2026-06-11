import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import type { ContentSelectionPreviewState } from '@/components/editor/prompt-inputs-editor/types'
import type { ContentSelectionTarget, PromptContentSelectionInputDefinition } from '@/lib/prompt-inputs'

export type PreviewContentSelectionController = {
    allowMultiple: boolean
    enabled: PromptContentSelectionInputDefinition['contentSelection']['options']
    state: ContentSelectionPreviewState
    selectedKeys: Set<string>
    hasActSelections: boolean
    hasChapterSelections: boolean
    fullNovelTreatLabel: string
    actTreatLabel: string
    chapterTreatLabel: string
    sceneTreatLabel: string
    labelTreatSummary: string
    buttonLabel: string
    addOrRemove: (target: ContentSelectionTarget, shouldSelect: boolean) => void
    selectSingle: (target: ContentSelectionTarget) => void
    clearSelections: () => void
}

export type PreviewContentSelectionSectionProps = {
    input: PromptContentSelectionInputDefinition
    model: InputsEditorModel
    controller: PreviewContentSelectionController
}
