'use client'

import { cn } from '@/lib/utils'
import { croppedImageStyle, type ImageCrop } from '@/lib/image-crop'
import { UserImage } from '@/components/image/user-image'

interface CroppedImageProps {
    src: string
    /** Display aspect ratio as width / height (e.g. cover = 1 / 1.6). */
    aspectRatio: number
    crop?: ImageCrop | null
    alt?: string
    className?: string
    /** Class for the rendered image (e.g. to round avatars). */
    imageClassName?: string
}

/**
 * Read-only image displayed cropped to a fixed-aspect frame.
 *
 * With a `crop`, the chosen region is shown (non-destructive — the original
 * file is untouched). Without one, falls back to centered `object-cover`, so
 * images that have never been cropped still render correctly.
 *
 * Shared by every cover/avatar display site so the cropping rule lives in one
 * place.
 */
export function CroppedImage({
    src,
    aspectRatio,
    crop,
    alt = '',
    className,
    imageClassName,
}: CroppedImageProps) {
    return (
        <div className={cn('relative overflow-hidden', className)} style={{ aspectRatio }}>
            {crop ? (
                <UserImage src={src} alt={alt} style={croppedImageStyle(crop)} className={imageClassName} draggable={false} />
            ) : (
                <UserImage
                    src={src}
                    alt={alt}
                    className={cn('absolute inset-0 h-full w-full object-cover', imageClassName)}
                    draggable={false}
                />
            )}
        </div>
    )
}
