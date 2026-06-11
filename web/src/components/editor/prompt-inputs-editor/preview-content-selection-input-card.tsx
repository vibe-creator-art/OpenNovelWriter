'use client'

import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import type { ContentSelectionTarget, PromptContentSelectionInputDefinition } from '@/lib/prompt-inputs'
import { PreviewInputCardFrame } from '@/components/editor/prompt-inputs-editor/preview-input-card-frame'
import { selectionKey } from '@/components/editor/prompt-inputs-editor/utils'
import { PreviewContentSelectionMenu } from '@/components/editor/prompt-inputs-editor/preview-content-selection-menu'
import type { PreviewContentSelectionController } from '@/components/editor/prompt-inputs-editor/preview-content-selection-shared'
import { PreviewContentSelectionSelectedItems } from '@/components/editor/prompt-inputs-editor/preview-content-selection-selected-items'

export function PreviewContentSelectionInputCard({
    input,
    model,
}: {
    input: PromptContentSelectionInputDefinition
    model: InputsEditorModel
}) {
    const {
        t,
        contentSelectionPreviewStateByInputId,
        handleUpdateContentSelectionPreviewState,
    } = model
    const title = input.name.trim() || t('advanced.inputs.untitled')
    const description = input.description?.trim() ? input.description : null
    const allowMultiple = input.contentSelection.allowMultiple
    const enabled = input.contentSelection.options
    const state = contentSelectionPreviewStateByInputId[input.id] ?? {
        selections: [],
    }
    const selectedKeys = new Set(state.selections.map(selectionKey))
    const hasActSelections = state.selections.some((selection) => selection.kind === 'act')
    const hasChapterSelections = state.selections.some((selection) => selection.kind === 'chapter')

    const addOrRemove = (target: ContentSelectionTarget, shouldSelect: boolean) => {
        handleUpdateContentSelectionPreviewState(input.id, { selections: [] }, (prev) => {
            const key = selectionKey(target)
            const without = prev.selections.filter((item) => selectionKey(item) !== key)
            if (!shouldSelect) return { selections: without }
            if (!allowMultiple) return { selections: [target] }
            return { selections: [...without, target] }
        })
    }

    const selectSingle = (target: ContentSelectionTarget) => {
        handleUpdateContentSelectionPreviewState(input.id, { selections: [] }, () => ({
            selections: [target],
        }))
    }

    const clearSelections = () => {
        handleUpdateContentSelectionPreviewState(input.id, { selections: [] }, () => ({
            selections: [],
        }))
    }

    const fullNovelTreatLabel =
        enabled.fullNovel.treatAs === 'full_text'
            ? t('advanced.contentSelection.fullText')
            : t('advanced.contentSelection.summary')
    const actTreatLabel =
        enabled.act.treatAs === 'full_text'
            ? t('advanced.contentSelection.fullText')
            : t('advanced.contentSelection.summary')
    const chapterTreatLabel =
        enabled.chapter.treatAs === 'full_text'
            ? t('advanced.contentSelection.fullText')
            : t('advanced.contentSelection.summary')
    const sceneTreatLabel =
        enabled.scene.treatAs === 'full_text'
            ? t('advanced.contentSelection.fullText')
            : t('advanced.contentSelection.summary')
    const labelActTreatLabel =
        enabled.label.actTreatAs === 'full_text'
            ? t('advanced.contentSelection.fullText')
            : t('advanced.contentSelection.summary')
    const labelSceneTreatLabel =
        enabled.label.sceneTreatAs === 'full_text'
            ? t('advanced.contentSelection.fullText')
            : t('advanced.contentSelection.summary')
    const labelTreatSummary =
        enabled.label.actTreatAs === enabled.label.sceneTreatAs
            ? labelActTreatLabel
            : `${t('advanced.contentSelection.act')}: ${labelActTreatLabel} · ${t(
                  'advanced.contentSelection.scene'
              )}: ${labelSceneTreatLabel}`
    const buttonLabel =
        input.contentSelection.displayName.trim() || input.name.trim() || t('advanced.inputs.untitled')

    const controller: PreviewContentSelectionController = {
        allowMultiple,
        enabled,
        state,
        selectedKeys,
        hasActSelections,
        hasChapterSelections,
        fullNovelTreatLabel,
        actTreatLabel,
        chapterTreatLabel,
        sceneTreatLabel,
        labelTreatSummary,
        buttonLabel,
        addOrRemove,
        selectSingle,
        clearSelections,
    }

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
            <div className="space-y-2">
                <div className="flex flex-wrap items-start gap-2">
                    <PreviewContentSelectionMenu input={input} model={model} controller={controller} />
                    <PreviewContentSelectionSelectedItems model={model} controller={controller} />
                </div>
            </div>
        </PreviewInputCardFrame>
    )
}
