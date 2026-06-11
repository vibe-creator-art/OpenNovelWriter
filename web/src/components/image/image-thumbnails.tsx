'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ImageViewerDialog } from '@/components/image/image-viewer-dialog'

/** Message-bubble image thumbnails; click any to open it in the shared viewer. */
export function ImageThumbnails({ urls, className }: { urls: string[] | null | undefined; className?: string }) {
    const [openUrl, setOpenUrl] = useState<string | null>(null)

    if (!urls || urls.length === 0) return null

    return (
        <>
            <div className={cn('flex flex-wrap gap-1.5', className)}>
                {urls.map((url, index) => (
                    <button
                        key={`${url}-${index}`}
                        type="button"
                        className="overflow-hidden rounded-lg border border-foreground/10 transition-opacity hover:opacity-85"
                        onClick={() => setOpenUrl(url)}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" loading="lazy" className="h-24 max-w-44 object-cover" />
                    </button>
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
