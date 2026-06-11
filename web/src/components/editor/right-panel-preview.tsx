'use client'

import { useTranslations } from 'next-intl'
import { useInfoPanelStore } from '@/components/editor/info-panel-store'
import { PreviewPanel } from '@/components/editor/prompt-inputs-editor/preview-panel'

export function RightPanelPreview() {
    const t = useTranslations('editor')
    const preview = useInfoPanelStore((s) => s.preview)

    if (!preview || preview.kind !== 'prompt_render') {
        return (
            <div className="p-4">
                <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                    {t('infoPanel.previewEmptyHint')}
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col p-0">
            <PreviewPanel
                model={preview.model}
                mode="preview"
                hideContextScenePicker
                fillHeight
                className="h-full rounded-none border-0 bg-transparent p-2"
            />
        </div>
    )
}
