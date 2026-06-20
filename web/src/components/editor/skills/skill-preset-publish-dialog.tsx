'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { BuiltinSkillPreset } from '@/lib/api'

type SkillPresetPublishDialogProps = {
    open: boolean
    mode: 'create' | 'overwrite'
    presets: BuiltinSkillPreset[]
    presetName: string
    description: string
    overwritePresetId: string
    busy: boolean
    error: string | null
    onOpenChange: (open: boolean) => void
    onPresetNameChange: (value: string) => void
    onDescriptionChange: (value: string) => void
    onOverwritePresetIdChange: (value: string) => void
    onSubmit: () => void | Promise<void>
}

export function SkillPresetPublishDialog({
    open,
    mode,
    presets,
    presetName,
    description,
    overwritePresetId,
    busy,
    error,
    onOpenChange,
    onPresetNameChange,
    onDescriptionChange,
    onOverwritePresetIdChange,
    onSubmit,
}: SkillPresetPublishDialogProps) {
    const t = useTranslations('skills')
    const selectedOverwritePreset = presets.find((preset) => preset.presetId === overwritePresetId) ?? null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{mode === 'create' ? t('presets.publish.createTitle') : t('presets.publish.overwriteTitle')}</DialogTitle>
                    <DialogDescription>
                        {mode === 'create' ? t('presets.publish.createDescription') : t('presets.publish.overwriteDescription')}
                    </DialogDescription>
                </DialogHeader>

                {error && <div className="text-sm text-destructive">{error}</div>}

                <div className="space-y-4">
                    {mode === 'overwrite' && (
                        <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">{t('presets.publish.overwritePreset')}</div>
                            <Select value={overwritePresetId} onValueChange={onOverwritePresetIdChange}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t('presets.publish.selectPreset')} />
                                </SelectTrigger>
                                <SelectContent align="start">
                                    {presets.map((preset) => (
                                        <SelectItem key={preset.presetId} value={preset.presetId}>
                                            {preset.name} ({t('presets.revision', { revision: preset.revision.toFixed(1) })})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {selectedOverwritePreset && (
                                <div className="text-xs text-muted-foreground">
                                    {selectedOverwritePreset.presetId}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">{t('presets.publish.name')}</div>
                        <Input value={presetName} onChange={(event) => onPresetNameChange(event.target.value)} />
                    </div>

                    <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">{t('presets.publish.descriptionLabel')}</div>
                        <Textarea
                            value={description}
                            onChange={(event) => onDescriptionChange(event.target.value)}
                            placeholder={t('presets.publish.descriptionPlaceholder')}
                            className="field-sizing-fixed h-28 resize-none"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                        {t('presets.cancel')}
                    </Button>
                    <Button type="button" disabled={busy || (mode === 'overwrite' && presets.length === 0)} onClick={() => void onSubmit()}>
                        {busy ? t('presets.publish.saving') : mode === 'create' ? t('presets.publish.createSubmit') : t('presets.publish.overwriteSubmit')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
