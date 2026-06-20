'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { BuiltinPromptPreset } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Box, ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react'
import type { PromptTranslateFn } from '@/components/editor/prompts/middle-panel-prompts-shared'

type PromptPresetLibrarySectionProps = {
    t: PromptTranslateFn
    presets: BuiltinPromptPreset[]
    loading: boolean
    error: string | null
    cloningPresetId: string | null
    cloningAll: boolean
    cloneConflictNames: string[]
    cloneOverwriteConfirmOpen: boolean
    onClonePreset: (presetId: string, overwriteExisting?: boolean) => void | Promise<void>
    onCloneAllPresets: () => void | Promise<void>
    onCloneOverwriteConfirmOpenChange: (open: boolean) => void
    onConfirmCloneOverwrite: () => void | Promise<void>
    className?: string
}

export function PromptPresetLibrarySection({
    t,
    presets,
    loading,
    error,
    cloningPresetId,
    cloningAll,
    cloneConflictNames,
    cloneOverwriteConfirmOpen,
    onClonePreset,
    onCloneAllPresets,
    onCloneOverwriteConfirmOpenChange,
    onConfirmCloneOverwrite,
    className,
}: PromptPresetLibrarySectionProps) {
    const visiblePresets = useMemo(() => presets.filter((preset) => preset.promptCount > 0), [presets])
    const [expanded, setExpanded] = useState(false)

    if (!loading && !error && visiblePresets.length === 0) return null

    return (
        <>
            <div className={cn('space-y-3 border-b p-3', className)}>
                <div className="flex items-start gap-2">
                    <button
                        type="button"
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        onClick={() => setExpanded((current) => !current)}
                    >
                        {expanded ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Sparkles className="h-4 w-4 text-muted-foreground" />
                                <span>{t('presets.title')}</span>
                            </div>
                            <p className="text-xs leading-5 text-muted-foreground">{t('presets.description')}</p>
                        </div>
                    </button>
                    {visiblePresets.length > 0 && (
                        <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 gap-1"
                            onClick={() => void onCloneAllPresets()}
                            disabled={cloningAll || cloningPresetId !== null}
                        >
                            {cloningAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            {t('presets.cloneAll')}
                        </Button>
                    )}
                </div>

                {expanded && (
                    <>
                        {error && (
                            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                                {error}
                            </div>
                        )}

                        {loading ? (
                            <div className="rounded-md border border-dashed bg-background/70 px-3 py-4 text-xs text-muted-foreground">
                                {t('presets.loading')}
                            </div>
                        ) : visiblePresets.length === 0 ? (
                            <div className="rounded-md border border-dashed bg-background/70 px-3 py-4 text-xs text-muted-foreground">
                                {t('presets.empty')}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {visiblePresets.map((preset) => (
                                    <div key={preset.presetId} className="rounded-md border bg-background/80 p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium">{preset.name}</div>
                                                {preset.description?.trim() && (
                                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                                        {preset.description}
                                                    </p>
                                                )}
                                            </div>
                                            <Badge variant="secondary" className="shrink-0 font-normal">
                                                {t('presets.revision', { revision: preset.revision.toFixed(1) })}
                                            </Badge>
                                        </div>

                                        <div className="mt-2 flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                <Badge variant="outline" className="font-normal">
                                                    <Box className="mr-1 h-3 w-3" />
                                                    {t('presets.promptCount', { count: preset.promptCount })}
                                                </Badge>
                                                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                                                    {preset.entryPromptName}
                                                </span>
                                            </div>
                                            <Button
                                                size="sm"
                                                className="shrink-0 gap-1"
                                                onClick={() => void onClonePreset(preset.presetId, false)}
                                                disabled={cloningPresetId === preset.presetId}
                                            >
                                                {cloningPresetId === preset.presetId ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Sparkles className="h-4 w-4" />
                                                )}
                                                {t('presets.clone')}
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            <AlertDialog open={cloneOverwriteConfirmOpen} onOpenChange={onCloneOverwriteConfirmOpenChange}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('presets.overwriteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('presets.overwriteDialog.description')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        {cloneConflictNames.join(', ')}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={cloningPresetId !== null}>{t('clipboard.common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction disabled={cloningPresetId !== null} onClick={() => void onConfirmCloneOverwrite()}>
                            {cloningPresetId !== null ? t('presets.cloning') : t('presets.overwriteDialog.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
