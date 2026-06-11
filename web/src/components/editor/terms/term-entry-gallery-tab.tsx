'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CircleUserRound, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImageViewerDialog } from '@/components/image/image-viewer-dialog'
import { uploadApi } from '@/lib/api'
import { createId } from '@/components/editor/terms/utils'
import type { TermEntry } from '@/components/editor/terms/types'

/**
 * Gallery tab of the term panel: a grid of images attached to the entry
 * (uploaded here or imported from the chat / codex viewers). Clicking one
 * opens the shared viewer with set-as-avatar / remove on top of copy /
 * download. Removal only drops the reference — the image GC reclaims the
 * file once nothing else points at it.
 */
export function TermEntryGalleryTab({
    entry,
    onUpdate,
}: {
    entry: TermEntry
    onUpdate: (patch: Partial<TermEntry>) => void
}) {
    const t = useTranslations('editor.terms.panel.gallery')
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const [uploading, setUploading] = useState(false)
    const [uploadFailed, setUploadFailed] = useState(false)
    const [viewerUrl, setViewerUrl] = useState<string | null>(null)

    const gallery = entry.gallery ?? []

    const handleFiles = async (files: File[]) => {
        if (files.length === 0) return
        setUploading(true)
        setUploadFailed(false)
        try {
            const next = [...gallery]
            for (const file of files) {
                const { url } = await uploadApi.image(file)
                if (!next.some((item) => item.url === url)) {
                    next.push({ id: createId(), url })
                }
            }
            onUpdate({ gallery: next })
        } catch (error) {
            console.error('Failed to upload gallery image:', error)
            setUploadFailed(true)
        } finally {
            setUploading(false)
        }
    }

    return (
        <div className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
                {gallery.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className="aspect-square overflow-hidden rounded-lg border transition-opacity hover:opacity-85"
                        onClick={() => setViewerUrl(item.url)}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                ))}

                <button
                    type="button"
                    className="aspect-square flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                >
                    {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                    <span className="text-xs">{t('upload')}</span>
                </button>
            </div>

            {uploadFailed && <p className="text-sm text-destructive">{t('uploadFailed')}</p>}
            {gallery.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void handleFiles(Array.from(event.target.files ?? []))
                    event.target.value = ''
                }}
            />

            <ImageViewerDialog
                src={viewerUrl}
                open={viewerUrl !== null}
                onOpenChange={(isOpen) => !isOpen && setViewerUrl(null)}
                actions={
                    viewerUrl !== null && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    // The previous crop was made for another image — drop it.
                                    onUpdate({ avatar: viewerUrl, avatarCrop: undefined })
                                    setViewerUrl(null)
                                }}
                            >
                                <CircleUserRound className="mr-2 h-4 w-4" />
                                {t('setAvatar')}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                    onUpdate({ gallery: gallery.filter((item) => item.url !== viewerUrl) })
                                    setViewerUrl(null)
                                }}
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('remove')}
                            </Button>
                        </>
                    )
                }
            />
        </div>
    )
}
