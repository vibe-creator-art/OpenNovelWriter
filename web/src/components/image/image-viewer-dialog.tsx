'use client'

import { createContext, useContext, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * Context-injected action buttons appended to every viewer opened within the
 * provider's subtree (e.g. the chat / codex panels add "import to term
 * gallery"). Saves threading a prop through each viewer entry point.
 */
const ImageViewerExtraActionsContext = createContext<((src: string) => React.ReactNode) | null>(null)

export function ImageViewerExtraActionsProvider({
    render,
    children,
}: {
    render: (src: string) => React.ReactNode
    children: React.ReactNode
}) {
    return <ImageViewerExtraActionsContext.Provider value={render}>{children}</ImageViewerExtraActionsContext.Provider>
}

/** Re-encode any image blob as PNG via canvas (for clipboard compatibility). */
function blobToPng(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')
            if (!ctx) {
                URL.revokeObjectURL(url)
                reject(new Error('Failed to create canvas'))
                return
            }
            ctx.drawImage(img, 0, 0)
            canvas.toBlob((out) => {
                URL.revokeObjectURL(url)
                if (out) resolve(out)
                else reject(new Error('Failed to encode PNG'))
            }, 'image/png')
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('Failed to load image'))
        }
        img.src = url
    })
}

/**
 * Delegated click boundary for rendered markdown: clicking any descendant
 * carrying `data-onw-image` (emitted by simple-markdown for `![](…)`) opens
 * that URL in the shared viewer.
 */
export function ImageViewerBoundary({ children }: { children: React.ReactNode }) {
    const [src, setSrc] = useState<string | null>(null)

    return (
        <div
            onClick={(event) => {
                const el = (event.target as HTMLElement).closest<HTMLElement>('[data-onw-image]')
                const url = el?.getAttribute('data-onw-image')
                if (!url) return
                // Boundaries can nest (e.g. a model-reply card inside a Codex
                // message); only the innermost one should open a viewer.
                event.stopPropagation()
                setSrc(url)
            }}
        >
            {children}
            <ImageViewerDialog src={src} open={src !== null} onOpenChange={(isOpen) => !isOpen && setSrc(null)} />
        </div>
    )
}

/**
 * Shared image viewer card: full image plus a row of actions. Copy and
 * download are built in; callers append their own buttons via `actions`
 * (e.g. crop / replace / remove for editable fields, more later).
 */
export function ImageViewerDialog({
    src,
    open,
    onOpenChange,
    actions,
}: {
    src: string | null
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Extra action buttons rendered after the built-in copy / download. */
    actions?: React.ReactNode
}) {
    const t = useTranslations('imageEditor')
    const renderExtraActions = useContext(ImageViewerExtraActionsContext)
    const [copied, setCopied] = useState(false)
    const [copyFailed, setCopyFailed] = useState(false)

    const handleDownload = () => {
        if (!src) return
        const a = document.createElement('a')
        a.href = src
        a.download = src.split('/').pop() || 'image'
        document.body.appendChild(a)
        a.click()
        a.remove()
    }

    const handleCopy = async () => {
        if (!src) return
        setCopyFailed(false)
        try {
            const blob = await (await fetch(src)).blob()
            try {
                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
            } catch {
                // Some browsers only accept PNG on the clipboard — convert and retry.
                const png = await blobToPng(blob)
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
            }
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            setCopyFailed(true)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('editTitle')}</DialogTitle>
                </DialogHeader>

                {src && (
                    <div className="flex flex-col items-center gap-5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={src}
                            alt=""
                            draggable={false}
                            className="max-h-[60vh] w-auto max-w-full rounded-md object-contain shadow-sm"
                        />
                        {copyFailed && <p className="text-sm text-red-500">{t('copyFailed')}</p>}
                        <div className="flex w-full flex-wrap justify-center gap-2">
                            <Button type="button" variant="outline" onClick={handleCopy}>
                                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                                {copied ? t('copied') : t('copy')}
                            </Button>
                            <Button type="button" variant="outline" onClick={handleDownload}>
                                <Download className="mr-2 h-4 w-4" />
                                {t('download')}
                            </Button>
                            {actions}
                            {renderExtraActions?.(src)}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
