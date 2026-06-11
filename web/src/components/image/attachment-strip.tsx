'use client'

import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageViewerDialog } from '@/components/image/image-viewer-dialog'
import type { PendingImageAttachment } from '@/components/image/use-image-attachments'

/** Pending image thumbnails shown above a composer before the message is sent. */
export function AttachmentStrip({
    items,
    onRemove,
    className,
}: {
    items: PendingImageAttachment[]
    onRemove: (id: string) => void
    className?: string
}) {
    const [openUrl, setOpenUrl] = useState<string | null>(null)

    if (items.length === 0) return null

    return (
        <>
            <div className={cn('flex flex-wrap gap-2', className)}>
                {items.map((item) => (
                    <div key={item.id} className="group relative h-16 w-16 overflow-hidden rounded-lg border bg-muted/30">
                        <button
                            type="button"
                            className="h-full w-full"
                            onClick={() => setOpenUrl(item.previewUrl)}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                        </button>
                        {item.status === 'uploading' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                        )}
                        <button
                            type="button"
                            className={cn(
                                'absolute right-0.5 top-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full',
                                'bg-foreground/70 text-background opacity-0 transition-opacity',
                                'group-hover:opacity-100 focus-visible:opacity-100'
                            )}
                            onClick={() => onRemove(item.id)}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                ))}
            </div>

            <ImageViewerDialog
                src={openUrl}
                open={openUrl !== null}
                onOpenChange={(isOpen) => !isOpen && setOpenUrl(null)}
            />
        </>
    )
}
