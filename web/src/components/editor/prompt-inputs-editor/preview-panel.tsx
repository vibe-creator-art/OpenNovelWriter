'use client'

import type { InputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { PreviewInputCard } from '@/components/editor/prompt-inputs-editor/preview-input-card'
import { PreviewRenderedSection } from '@/components/editor/prompt-inputs-editor/preview-rendered-section'

export function PreviewPanel({
    model,
    mode = 'full',
    hideContextScenePicker = false,
    hideAddMissingButton = false,
    fillHeight = false,
    className,
}: {
    model: InputsEditorModel
    mode?: 'full' | 'tweak' | 'preview'
    hideContextScenePicker?: boolean
    hideAddMissingButton?: boolean
    fillHeight?: boolean
    className?: string
}) {
    const {
        t,
        disabled,
        handleAddMissingInputs,
        missingInputNames,
        isComponentPrompt,
        previewInputs,
        previewSceneOptions,
        previewSceneId,
        setPreviewSceneId,
    } = model

    const showInputs = mode !== 'preview'
    const showRendered = mode !== 'tweak'

    return (
        <div
            className={cn(
                'rounded-md border bg-card p-4 min-w-0',
                fillHeight && 'flex h-full min-h-0 flex-col',
                showInputs ? 'space-y-4' : 'space-y-0',
                className
            )}
        >
            {showInputs && (
                <>

                    {!hideContextScenePicker && !isComponentPrompt && previewSceneOptions.length > 0 && (
                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">{t('advanced.preview.contextScene')}</div>
                            <Select value={previewSceneId ?? ''} disabled={disabled} onValueChange={(value) => setPreviewSceneId(value)}>
                                <SelectTrigger className="h-8">
                                    <SelectValue placeholder={t('advanced.preview.contextScenePlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {previewSceneOptions.map((opt) => (
                                        <SelectItem key={opt.id} value={opt.id}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {missingInputNames.length > 0 && (
                        <div className="rounded-md border bg-yellow-50 px-3 py-3 text-sm text-yellow-900 space-y-2">
                            <div className="font-medium">{t('advanced.preview.missingTitle')}</div>
                            <div className="text-xs text-yellow-900/80">{missingInputNames.join(', ')}</div>
                            {!hideAddMissingButton && (
                                <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={handleAddMissingInputs}>
                                    {t('advanced.preview.addMissing')}
                                </Button>
                            )}
                        </div>
                    )}

	                    {previewInputs.length === 0 ? (
	                        <div className="rounded-md border bg-muted/20 px-3 py-6 text-sm text-muted-foreground text-center">
	                            {t('advanced.preview.empty')}
	                        </div>
	                    ) : (
	                        <div className="space-y-2">
	                            {previewInputs.map((input) => (
	                                <PreviewInputCard key={input.id} input={input} model={model} />
	                            ))}
	                        </div>
	                    )}
                </>
            )}

            {showRendered && !isComponentPrompt && (
                <PreviewRenderedSection model={model} showInputs={showInputs} fillHeight={fillHeight} />
            )}
        </div>
    )
}
