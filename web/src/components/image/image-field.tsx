'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Crop, RefreshCw, Trash2, Upload } from 'lucide-react'
import { uploadApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { CroppedImage } from '@/components/image/cropped-image'
import { ImageCropEditor } from '@/components/image/image-crop-editor'
import { ImageViewerDialog } from '@/components/image/image-viewer-dialog'
import type { ImageCrop } from '@/lib/image-crop'

export type ImageFieldValue = { url: string; crop: ImageCrop | null }

interface ImageFieldProps {
    value: ImageFieldValue | null
    /** Display aspect ratio as width / height (cover = 1 / 1.6, avatar = 1). */
    aspect: number
    shape?: 'rect' | 'circle'
    onChange: (value: ImageFieldValue | null) => void
    disabled?: boolean
    /** Sizing class for the inline preview frame (width). */
    previewClassName?: string
    /**
     * Custom clickable trigger replacing the default preview / upload button.
     * `open()` opens the card when an image exists, or the file picker when not.
     * Used e.g. by term avatars to keep their own icon-fallback chip.
     */
    renderTrigger?: (args: { value: ImageFieldValue | null; open: () => void }) => React.ReactNode
}

/**
 * Unified image control: upload, preview, and the shared viewer card extended
 * with crop / replace / remove. Cropping is non-destructive (stores a region,
 * keeps the original). Shared by novel covers and, later, term avatars — only
 * `aspect`/`shape` differ.
 */
export function ImageField({
    value,
    aspect,
    shape = 'rect',
    onChange,
    disabled,
    previewClassName,
    renderTrigger,
}: ImageFieldProps) {
    const t = useTranslations('imageEditor')
    const tCommon = useTranslations('common')

    const fileInputRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState('')
    const [cardOpen, setCardOpen] = useState(false)
    const [mode, setMode] = useState<'view' | 'crop'>('view')

    const open = () => {
        if (value) {
            setMode('view')
            setCardOpen(true)
        } else {
            fileInputRef.current?.click()
        }
    }

    const upload = async (file: File, { keepCrop }: { keepCrop: boolean }) => {
        setUploading(true)
        setError('')
        try {
            const result = await uploadApi.image(file)
            onChange({ url: result.url, crop: keepCrop ? (value?.crop ?? null) : null })
            setMode('view')
        } catch (err) {
            setError(err instanceof Error ? err.message : tCommon('uploadFailed'))
        } finally {
            setUploading(false)
        }
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) await upload(file, { keepCrop: false })
    }

    const frameClass = cn(shape === 'circle' ? 'rounded-full' : 'rounded-md', 'bg-muted')

    return (
        <div className="space-y-2">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
            />

            {error && <p className="text-sm text-red-500">{error}</p>}

            {renderTrigger ? (
                renderTrigger({ value, open })
            ) : value ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={open}
                    className={cn(
                        'group relative mx-auto block max-h-48 w-auto overflow-hidden border transition hover:opacity-90',
                        frameClass,
                        previewClassName,
                    )}
                    title={t('edit')}
                >
                    <CroppedImage src={value.url} crop={value.crop} aspectRatio={aspect} className="h-full w-full" />
                </button>
            ) : (
                <Button
                    type="button"
                    variant="outline"
                    className="h-24 w-full border-dashed"
                    onClick={open}
                    disabled={disabled || uploading}
                >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploading ? t('uploading') : t('upload')}
                </Button>
            )}

            {/* Full original image, for viewing/appreciation — not the cropped region. */}
            <ImageViewerDialog
                src={value?.url ?? null}
                open={cardOpen && mode === 'view'}
                onOpenChange={(isOpen) => !isOpen && setCardOpen(false)}
                actions={
                    <>
                        <Button type="button" variant="outline" onClick={() => setMode('crop')}>
                            <Crop className="mr-2 h-4 w-4" />
                            {t('crop')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                        >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {uploading ? t('uploading') : t('replace')}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => {
                                onChange(null)
                                setCardOpen(false)
                            }}
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('remove')}
                        </Button>
                    </>
                }
            />

            <Dialog open={cardOpen && mode === 'crop'} onOpenChange={(isOpen) => !isOpen && setCardOpen(false)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('cropTitle')}</DialogTitle>
                    </DialogHeader>
                    {value && (
                        <ImageCropEditor
                            src={value.url}
                            aspect={aspect}
                            shape={shape}
                            initialCrop={value.crop}
                            onConfirm={(crop) => {
                                onChange({ url: value.url, crop })
                                setMode('view')
                            }}
                            onCancel={() => setMode('view')}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
