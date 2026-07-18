'use client'

import type { ChangeEvent, RefObject } from 'react'

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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type {
    PromptClipboardExportAnalysis,
    PromptClipboardImportAnalysis,
    PromptTranslateFn,
} from '@/components/editor/prompts/middle-panel-prompts-shared'
import type { PromptBundleV1 } from '@/lib/prompt-bundle'

export function PromptClipboardDialogs({
    t,
    clipboardExportOpen,
    clipboardExportFormat,
    clipboardExportBusy,
    clipboardExportError,
    clipboardExportAnalysis,
    clipboardImportOpen,
    clipboardImportText,
    clipboardImportBundle,
    clipboardImportMode,
    clipboardImportBusy,
    clipboardImportError,
    clipboardImportOverwriteConfirmOpen,
    clipboardImportConflictNames,
    clipboardImportAnalysis,
    promptBundleJsonImportInputRef,
    onClipboardExportOpenChange,
    onClipboardExportFormatChange,
    onClearClipboardExportError,
    onPerformClipboardExport,
    onClipboardImportOpenChange,
    onClipboardImportTextChange,
    onClipboardImportModeChange,
    onClipboardImportOverwriteConfirmOpenChange,
    onResetClipboardImportDialog,
    onBackFromClipboardImportPreview,
    onPasteClipboardImportText,
    onParseClipboardImport,
    onRunClipboardImport,
    onConfirmClipboardImportOverwrite,
    onJsonImportFileSelected,
}: {
    t: PromptTranslateFn
    clipboardExportOpen: boolean
    clipboardExportFormat: 'flatten' | 'bundle' | 'as_is'
    clipboardExportBusy: boolean
    clipboardExportError: string | null
    clipboardExportAnalysis: PromptClipboardExportAnalysis
    clipboardImportOpen: boolean
    clipboardImportText: string
    clipboardImportBundle: PromptBundleV1 | null
    clipboardImportMode: 'entry_only' | 'all'
    clipboardImportBusy: boolean
    clipboardImportError: string | null
    clipboardImportOverwriteConfirmOpen: boolean
    clipboardImportConflictNames: string[]
    clipboardImportAnalysis: PromptClipboardImportAnalysis
    promptBundleJsonImportInputRef: RefObject<HTMLInputElement | null>
    onClipboardExportOpenChange: (open: boolean) => void
    onClipboardExportFormatChange: (format: 'flatten' | 'bundle' | 'as_is') => void
    onClearClipboardExportError: () => void
    onPerformClipboardExport: (format: 'flatten' | 'bundle' | 'as_is') => void | Promise<void>
    onClipboardImportOpenChange: (open: boolean) => void
    onClipboardImportTextChange: (value: string) => void
    onClipboardImportModeChange: (mode: 'entry_only' | 'all') => void
    onClipboardImportOverwriteConfirmOpenChange: (open: boolean) => void
    onResetClipboardImportDialog: () => void
    onBackFromClipboardImportPreview: () => void
    onPasteClipboardImportText: () => void | Promise<void>
    onParseClipboardImport: () => void
    onRunClipboardImport: () => void | Promise<void>
    onConfirmClipboardImportOverwrite: () => void | Promise<void>
    onJsonImportFileSelected: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
}) {
    const flattenUnavailable =
        clipboardExportAnalysis.flattenMissingIncludes.length > 0 ||
        clipboardExportAnalysis.flattenCycles.length > 0 ||
        clipboardExportAnalysis.flattenDepthExceeded

    return (
        <>
            <Dialog
                open={clipboardExportOpen}
                onOpenChange={(open) => {
                    onClipboardExportOpenChange(open)
                    if (!open) onClearClipboardExportError()
                }}
            >
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{t('clipboard.export.title')}</DialogTitle>
                        <DialogDescription>{t('clipboard.export.description')}</DialogDescription>
                    </DialogHeader>

                    {clipboardExportError && <div className="text-sm text-destructive">{clipboardExportError}</div>}

                    <div className="space-y-3">
                        <button
                            type="button"
                            className={cn(
                                'w-full rounded-md border p-3 text-left transition-colors',
                                clipboardExportFormat === 'bundle' ? 'border-primary bg-muted' : 'hover:bg-muted'
                            )}
                            onClick={() => onClipboardExportFormatChange('bundle')}
                        >
                            <div className="flex items-center justify-between gap-2 text-sm font-medium">
                                <span>{t('clipboard.export.options.bundle.title')}</span>
                                <span className="text-xs text-muted-foreground">{t('clipboard.export.options.bundle.defaultBadge')}</span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">{t('clipboard.export.options.bundle.description')}</div>
                        </button>

                        <button
                            type="button"
                            className={cn(
                                'w-full rounded-md border p-3 text-left transition-colors',
                                clipboardExportFormat === 'flatten' ? 'border-primary bg-muted' : 'hover:bg-muted'
                            )}
                            onClick={() => onClipboardExportFormatChange('flatten')}
                        >
                            <div className="text-sm font-medium">{t('clipboard.export.options.flatten.title')}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{t('clipboard.export.options.flatten.description')}</div>
                            {flattenUnavailable && (
                                <div className="mt-2 text-xs text-destructive">{t('clipboard.export.options.flatten.unavailable')}</div>
                            )}
                        </button>

                        <button
                            type="button"
                            className={cn(
                                'w-full rounded-md border p-3 text-left transition-colors',
                                clipboardExportFormat === 'as_is' ? 'border-primary bg-muted' : 'hover:bg-muted'
                            )}
                            onClick={() => onClipboardExportFormatChange('as_is')}
                        >
                            <div className="text-sm font-medium">{t('clipboard.export.options.asIs.title')}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{t('clipboard.export.options.asIs.description')}</div>
                        </button>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium">{t('clipboard.export.dependenciesTitle')}</div>

                        <ScrollArea className="h-40 rounded-md border p-2">
                            <div className="space-y-2">
                                {clipboardExportAnalysis.dependencyPrompts.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">{t('clipboard.export.noDependencies')}</div>
                                ) : (
                                    clipboardExportAnalysis.dependencyPrompts.map((prompt) => (
                                        <div key={`${prompt.category}:${prompt.name}`} className="text-sm">
                                            <div className="truncate font-medium">{prompt.name}</div>
                                            <div className="truncate text-xs text-muted-foreground">{prompt.messages?.[0]?.content ?? ''}</div>
                                        </div>
                                    ))
                                )}

                                {clipboardExportAnalysis.missingIncludes.length > 0 && (
                                    <div className="border-t pt-2">
                                        <div className="text-xs font-medium text-destructive">{t('clipboard.export.missingDependenciesTitle')}</div>
                                        <div className="text-xs text-destructive">{clipboardExportAnalysis.missingIncludes.join(', ')}</div>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={clipboardExportBusy} onClick={() => onClipboardExportOpenChange(false)}>
                            {t('clipboard.common.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={clipboardExportBusy || (clipboardExportFormat === 'flatten' && flattenUnavailable)}
                            onClick={() => void onPerformClipboardExport(clipboardExportFormat)}
                        >
                            {clipboardExportBusy ? t('clipboard.common.copying') : t('clipboard.common.copy')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={clipboardImportOpen}
                onOpenChange={(open) => {
                    onClipboardImportOpenChange(open)
                    if (!open) onResetClipboardImportDialog()
                }}
            >
                <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>{t('clipboard.import.title')}</DialogTitle>
                        <DialogDescription>{t('clipboard.import.description')}</DialogDescription>
                    </DialogHeader>

                    {clipboardImportError && <div className="text-sm text-destructive">{clipboardImportError}</div>}

                    {!clipboardImportBundle ? (
                        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto">
                            <Textarea
                                value={clipboardImportText}
                                onChange={(event) => onClipboardImportTextChange(event.target.value)}
                                placeholder={t('clipboard.import.placeholder')}
                                className="field-sizing-fixed h-[240px] max-h-[45vh] resize-none font-mono text-xs"
                            />
                            <div className="flex items-center justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => void onPasteClipboardImportText()}>
                                    {t('clipboard.import.paste')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => promptBundleJsonImportInputRef.current?.click()}
                                >
                                    {t('clipboard.import.chooseFile')}
                                </Button>
                                <Button type="button" onClick={onParseClipboardImport}>
                                    {t('clipboard.import.parse')}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0 space-y-4 overflow-y-auto">
                            <div className="rounded-md border p-3">
                                <div className="text-sm font-medium">{clipboardImportBundle.entryName}</div>
                                <div className="text-xs text-muted-foreground">
                                    {t('clipboard.import.promptCount', { count: clipboardImportBundle.prompts.length })}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium">{t('clipboard.import.dependenciesTitle')}</div>
                                <ScrollArea className="h-40 rounded-md border p-2">
                                    <div className="space-y-2">
                                        {clipboardImportAnalysis.dependencies.length === 0 && clipboardImportAnalysis.missing.length === 0 ? (
                                            <div className="text-sm text-muted-foreground">{t('clipboard.import.noDependencies')}</div>
                                        ) : (
                                            clipboardImportAnalysis.dependencies.map((prompt) => (
                                                <div key={`${prompt.category}:${prompt.name}`} className="text-sm">
                                                    <div className="truncate font-medium">{prompt.name}</div>
                                                    <div className="truncate text-xs text-muted-foreground">{prompt.messages?.[0]?.content ?? ''}</div>
                                                </div>
                                            ))
                                        )}

                                        {clipboardImportAnalysis.missing.length > 0 && (
                                            <div className="border-t pt-2">
                                                <div className="text-xs font-medium text-destructive">{t('clipboard.import.missingDependenciesTitle')}</div>
                                                <div className="text-xs text-destructive">{clipboardImportAnalysis.missing.join(', ')}</div>
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>
                            </div>

                            {clipboardImportBundle.prompts.length > 1 && (
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">{t('clipboard.import.modeTitle')}</div>
                                    <div className="grid gap-2">
                                        <button
                                            type="button"
                                            className={cn(
                                                'w-full rounded-md border p-3 text-left transition-colors',
                                                clipboardImportMode === 'entry_only' ? 'border-primary bg-muted' : 'hover:bg-muted'
                                            )}
                                            onClick={() => onClipboardImportModeChange('entry_only')}
                                        >
                                            <div className="text-sm font-medium">{t('clipboard.import.modes.entryOnly.title')}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">{t('clipboard.import.modes.entryOnly.description')}</div>
                                        </button>
                                        <button
                                            type="button"
                                            className={cn(
                                                'w-full rounded-md border p-3 text-left transition-colors',
                                                clipboardImportMode === 'all' ? 'border-primary bg-muted' : 'hover:bg-muted'
                                            )}
                                            onClick={() => onClipboardImportModeChange('all')}
                                        >
                                            <div className="text-sm font-medium">{t('clipboard.import.modes.all.title')}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">{t('clipboard.import.modes.all.description')}</div>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {clipboardImportConflictNames.length > 0 && (
                                <div className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                                    <div className="font-medium">{t('clipboard.import.conflictsTitle')}</div>
                                    <div className="mt-1 text-xs text-amber-800 dark:text-amber-300">{clipboardImportConflictNames.join(', ')}</div>
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-2">
                                <Button type="button" variant="outline" disabled={clipboardImportBusy} onClick={onBackFromClipboardImportPreview}>
                                    {t('clipboard.common.back')}
                                </Button>
                                <div className="flex items-center gap-2">
                                    <Button type="button" variant="outline" disabled={clipboardImportBusy} onClick={() => onClipboardImportOpenChange(false)}>
                                        {t('clipboard.common.cancel')}
                                    </Button>
                                    <Button type="button" disabled={clipboardImportBusy} onClick={() => void onRunClipboardImport()}>
                                        {clipboardImportBusy ? t('clipboard.common.importing') : t('clipboard.common.import')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <input
                ref={promptBundleJsonImportInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void onJsonImportFileSelected(event)}
            />

            <AlertDialog open={clipboardImportOverwriteConfirmOpen} onOpenChange={onClipboardImportOverwriteConfirmOpenChange}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('clipboard.import.overwriteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('clipboard.import.overwriteDialog.description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                        {clipboardImportConflictNames.join(', ')}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={clipboardImportBusy}>
                            {t('clipboard.common.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction disabled={clipboardImportBusy} onClick={() => void onConfirmClipboardImportOverwrite()}>
                            {clipboardImportBusy ? t('clipboard.common.importing') : t('clipboard.import.overwriteDialog.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
