'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ImageCrop } from '@/lib/image-crop'

interface ImageCropEditorProps {
    src: string
    /** Display aspect ratio as width / height (cover = 1 / 1.6, avatar = 1). */
    aspect: number
    shape?: 'rect' | 'circle'
    initialCrop?: ImageCrop | null
    onConfirm: (crop: ImageCrop) => void
    onCancel: () => void
}

const MAX_W = 300
const MAX_H = 380
const MAX_ZOOM = 3

function clamp(v: number, min: number, max: number) {
    return Math.min(max, Math.max(min, v))
}

/**
 * Lets the user select which region of an image fills a fixed-aspect frame by
 * panning and zooming. Outputs a normalized crop rectangle — it never re-encodes
 * the image. Reused for covers and (later) avatars by changing `aspect`/`shape`.
 */
export function ImageCropEditor({
    src,
    aspect,
    shape = 'rect',
    initialCrop,
    onConfirm,
    onCancel,
}: ImageCropEditorProps) {
    const t = useTranslations('imageEditor')

    // Fixed viewport sized to the target aspect within a bounding box.
    const viewport =
        aspect >= 1 ? { w: MAX_W, h: MAX_W / aspect } : { w: MAX_H * aspect, h: MAX_H }

    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
    const [scale, setScale] = useState(1)
    const [offset, setOffset] = useState({ x: 0, y: 0 })

    const coverBase = natural ? Math.max(viewport.w / natural.w, viewport.h / natural.h) : 1
    const drawn = natural
        ? { w: natural.w * coverBase * scale, h: natural.h * coverBase * scale }
        : { w: viewport.w, h: viewport.h }

    const clampOffset = useCallback(
        (x: number, y: number, dw: number, dh: number) => ({
            x: clamp(x, viewport.w - dw, 0),
            y: clamp(y, viewport.h - dh, 0),
        }),
        [viewport.w, viewport.h],
    )

    const handleLoad = useCallback(
        (e: React.SyntheticEvent<HTMLImageElement>) => {
            const img = e.currentTarget
            const nat = { w: img.naturalWidth, h: img.naturalHeight }
            if (!nat.w || !nat.h) return
            setNatural(nat)

            const base = Math.max(viewport.w / nat.w, viewport.h / nat.h)
            if (initialCrop && initialCrop.w > 0) {
                const k = viewport.w / (initialCrop.w * nat.w)
                const nextScale = clamp(k / base, 1, MAX_ZOOM)
                const kk = base * nextScale
                const dw = nat.w * kk
                const dh = nat.h * kk
                setScale(nextScale)
                setOffset(clampOffset(-initialCrop.x * nat.w * kk, -initialCrop.y * nat.h * kk, dw, dh))
            } else {
                const dw = nat.w * base
                const dh = nat.h * base
                setScale(1)
                setOffset({ x: (viewport.w - dw) / 2, y: (viewport.h - dh) / 2 })
            }
        },
        [viewport.w, viewport.h, initialCrop, clampOffset],
    )

    // Pointer drag to pan.
    const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
    const onPointerDown = (e: React.PointerEvent) => {
        if (!natural) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y }
    }
    const onPointerMove = (e: React.PointerEvent) => {
        if (!drag.current) return
        const next = clampOffset(
            drag.current.ox + (e.clientX - drag.current.px),
            drag.current.oy + (e.clientY - drag.current.py),
            drawn.w,
            drawn.h,
        )
        setOffset(next)
    }
    const onPointerUp = (e: React.PointerEvent) => {
        drag.current = null
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
            // capture may already be gone
        }
    }

    // Zoom about the viewport center.
    const onZoom = (nextScale: number) => {
        if (!natural) return
        const kOld = coverBase * scale
        const kNew = coverBase * nextScale
        const naturalCx = (viewport.w / 2 - offset.x) / kOld
        const naturalCy = (viewport.h / 2 - offset.y) / kOld
        const dw = natural.w * kNew
        const dh = natural.h * kNew
        setScale(nextScale)
        setOffset(clampOffset(viewport.w / 2 - naturalCx * kNew, viewport.h / 2 - naturalCy * kNew, dw, dh))
    }

    const handleConfirm = () => {
        if (!natural) return
        const k = coverBase * scale
        onConfirm({
            x: clamp((-offset.x / k) / natural.w, 0, 1),
            y: clamp((-offset.y / k) / natural.h, 0, 1),
            w: clamp((viewport.w / k) / natural.w, 0, 1),
            h: clamp((viewport.h / k) / natural.h, 0, 1),
        })
    }

    return (
        <div className="flex flex-col items-center gap-4">
            <div
                className="relative overflow-hidden rounded-md bg-muted touch-none select-none cursor-grab active:cursor-grabbing"
                style={{ width: viewport.w, height: viewport.h }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={src}
                    alt=""
                    onLoad={handleLoad}
                    draggable={false}
                    style={{
                        position: 'absolute',
                        left: offset.x,
                        top: offset.y,
                        width: drawn.w,
                        height: drawn.h,
                        maxWidth: 'none',
                    }}
                />
                {shape === 'circle' && (
                    <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
                )}
            </div>

            <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={scale}
                onChange={(e) => onZoom(Number(e.target.value))}
                disabled={!natural}
                className={cn('w-full max-w-[300px]', !natural && 'opacity-50')}
                aria-label={t('zoom')}
            />

            <div className="flex w-full justify-end gap-2">
                <Button type="button" variant="outline" onClick={onCancel}>
                    {t('cancel')}
                </Button>
                <Button type="button" onClick={handleConfirm} disabled={!natural}>
                    {t('confirm')}
                </Button>
            </div>
        </div>
    )
}
