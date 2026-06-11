import type { CSSProperties } from 'react'

/**
 * A non-destructive crop: a rectangle in the source image's own coordinate
 * space, normalized to [0,1]. The original file is never modified — display
 * components apply this rectangle to a fixed-aspect frame.
 *
 * The rect's pixel aspect (w*naturalW : h*naturalH) equals the display aspect,
 * which is why CroppedImage can place the image without knowing natural dims.
 */
export type ImageCrop = { x: number; y: number; w: number; h: number }

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}

export function parseImageCrop(value: string | null | undefined): ImageCrop | null {
    if (!value) return null
    try {
        const c = JSON.parse(value) as Partial<ImageCrop>
        if (
            typeof c?.x === 'number' &&
            typeof c?.y === 'number' &&
            typeof c?.w === 'number' &&
            typeof c?.h === 'number' &&
            c.w > 0 &&
            c.h > 0
        ) {
            return {
                x: clamp(c.x, 0, 1),
                y: clamp(c.y, 0, 1),
                w: clamp(c.w, 0, 1),
                h: clamp(c.h, 0, 1),
            }
        }
    } catch {
        // fall through
    }
    return null
}

export function serializeImageCrop(crop: ImageCrop | null | undefined): string | null {
    if (!crop) return null
    const round = (n: number) => Math.round(n * 1e6) / 1e6
    return JSON.stringify({ x: round(crop.x), y: round(crop.y), w: round(crop.w), h: round(crop.h) })
}

/**
 * Absolute-position styles that make `crop` fill a relatively-positioned,
 * fixed-aspect parent. No knowledge of the image's natural size is required.
 */
export function croppedImageStyle(crop: ImageCrop): CSSProperties {
    return {
        position: 'absolute',
        width: `${100 / crop.w}%`,
        height: `${100 / crop.h}%`,
        left: `${(-100 * crop.x) / crop.w}%`,
        top: `${(-100 * crop.y) / crop.h}%`,
        maxWidth: 'none',
    }
}
