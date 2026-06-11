'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import type { RevisionHistoryItem } from '@/lib/revision-history'

type RevisionHistoryDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentValue: string
    historyItems: RevisionHistoryItem[]
    onRestore: (value: string) => void
    title: string
    restoreLabel: string
    closeLabel: string
    emptyLabel: string
    editedByLabel: string
    previewTransform?: (value: string) => string
}

export function RevisionHistoryDialog({
    open,
    onOpenChange,
    currentValue,
    historyItems,
    onRestore,
    title,
    restoreLabel,
    closeLabel,
    emptyLabel,
    editedByLabel,
    previewTransform,
}: RevisionHistoryDialogProps) {
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const effectiveSelectedId = selectedId ?? historyItems[0]?.id ?? null
    const requestClose = () => {
        setSelectedId(null)
        onOpenChange(false)
    }

    const selectedItem = useMemo(() => {
        if (!effectiveSelectedId) return null
        return historyItems.find((h) => h.id === effectiveSelectedId) ?? null
    }, [effectiveSelectedId, historyItems])

    const rawPreviewValue = selectedItem?.value ?? currentValue ?? ''
    const previewValue = previewTransform ? previewTransform(rawPreviewValue) : rawPreviewValue

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) setSelectedId(null)
                onOpenChange(nextOpen)
            }}
        >
            <DialogContent
                className="sm:max-w-6xl h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)] p-0 overflow-hidden rounded-xl"
                showCloseButton={false}
            >
                <div className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)]">
                    <div className="border-b px-6 py-4 flex items-center justify-between">
                        <DialogTitle className="text-2xl">{title}</DialogTitle>
                        <Button variant="ghost" size="sm" onClick={requestClose}>
                            {closeLabel}
                        </Button>
                    </div>

                    <div className="min-h-0 grid grid-cols-[minmax(0,1fr)_320px]">
                        <div className="min-h-0 overflow-y-auto">
                            <div className="p-6">
                                <div className="whitespace-pre-wrap text-sm leading-relaxed">{previewValue}</div>
                            </div>
                        </div>

                        <div className="min-h-0 border-l bg-muted/30 flex flex-col overflow-hidden">
                            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                                {historyItems.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">{emptyLabel}</div>
                                ) : (
                                    <div className="space-y-3">
                                        {historyItems.map((h, index) => {
                                            const isSelected = effectiveSelectedId === h.id
                                            const showLine = index !== historyItems.length - 1
                                            return (
                                                <button
                                                    key={h.id}
                                                    type="button"
                                                    onClick={() => setSelectedId(h.id)}
                                                    className="group w-full text-left flex items-start gap-3"
                                                >
                                                    <div className="mt-1 flex w-6 flex-col items-center self-stretch">
                                                        {isSelected ? (
                                                            <div className="h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center">
                                                                <ArrowRight className="h-4 w-4" />
                                                            </div>
                                                        ) : (
                                                            <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                                                        )}
                                                        {showLine && <div className="mt-1 w-px flex-1 bg-border" />}
                                                    </div>
                                                    <div
                                                        className={cn(
                                                            'flex-1 rounded-lg border px-3 py-2 transition-colors shadow-sm',
                                                            isSelected
                                                                ? 'bg-foreground text-background border-foreground'
                                                                : 'bg-background/80 border-border/60 group-hover:bg-background'
                                                        )}
                                                    >
                                                        <div className="text-sm font-medium">{new Date(h.ts).toLocaleString()}</div>
                                                        <div className={cn('text-xs', isSelected ? 'text-background/80' : 'text-muted-foreground')}>
                                                            {editedByLabel}
                                                        </div>
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="shrink-0 border-t bg-background px-4 py-4 flex items-center justify-between gap-3">
                                <Button
                                    onClick={() => {
                                        if (!selectedItem) return
                                        if (selectedItem.value === (currentValue ?? '')) {
                                            requestClose()
                                            return
                                        }
                                        onRestore(selectedItem.value)
                                        requestClose()
                                    }}
                                    disabled={!selectedItem}
                                >
                                    {restoreLabel}
                                </Button>
                                <Button variant="ghost" onClick={requestClose}>
                                    {closeLabel}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
