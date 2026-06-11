'use client'

import { useEffect } from 'react'
import { useAiRunUiStore } from '@/lib/ai-run-ui-store'
import { cn } from '@/lib/utils'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'

function AiFallbackToast() {
    const toast = useAiRunUiStore((s) => s.toast)
    const hideToast = useAiRunUiStore((s) => s.hideToast)

    useEffect(() => {
        if (!toast) return
        const id = toast.id
        const timer = setTimeout(() => hideToast(id), toast.durationMs)
        return () => clearTimeout(timer)
    }, [hideToast, toast])

    if (!toast) return null

    return (
        <div className="fixed left-1/2 top-[18vh] z-[1000] w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 px-4 pointer-events-none">
            <div
                key={toast.id}
                className={cn(
                    'pointer-events-auto rounded-lg border bg-background/95 backdrop-blur shadow-lg',
                    'px-4 py-3'
                )}
            >
                <div className="text-sm leading-relaxed">{toast.message}</div>
                <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                        key={`${toast.id}:progress`}
                        className="h-full w-full bg-primary ai-fallback-progress"
                        style={{ animationDuration: `${toast.durationMs}ms` }}
                    />
                </div>
            </div>
        </div>
    )
}

function AiRunFatalDialog() {
    const fatal = useAiRunUiStore((s) => s.fatal)
    const hideFatal = useAiRunUiStore((s) => s.hideFatal)

    return (
        <AlertDialog
            open={!!fatal}
            onOpenChange={(open) => {
                if (!open) hideFatal()
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{fatal?.title ?? ''}</AlertDialogTitle>
                    <AlertDialogDescription>{fatal?.description ?? ''}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogAction onClick={hideFatal}>我知道了</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export function AiRunUi() {
    return (
        <>
            <AiFallbackToast />
            <AiRunFatalDialog />
        </>
    )
}
