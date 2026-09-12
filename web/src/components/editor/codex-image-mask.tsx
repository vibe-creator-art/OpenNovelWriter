'use client'

import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, RotateCw, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ImageBrushSize } from './codex-image-brush-size'

type Point = { x: number; y: number }
type Stroke = { points: Point[]; width: number }

export const REMOVE_IMAGE_AREA_PROMPT = 'Remove the area marked in the second image from the first image'

function paintStrokes(context: CanvasRenderingContext2D, strokes: Stroke[], color: string) {
    context.strokeStyle = color
    context.fillStyle = color
    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const stroke of strokes) {
        const first = stroke.points[0]
        if (!first) continue
        context.lineWidth = stroke.width
        context.beginPath()
        context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2)
        context.fill()
        context.beginPath()
        context.moveTo(first.x, first.y)
        for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y)
        context.stroke()
    }
}

export function ImageMaskOverlay({ width, height, toolbar, brushControls, busy, onSend, onClose }: {
    width: number
    height: number
    toolbar: HTMLElement | null
    brushControls: HTMLElement | null
    busy: boolean
    onSend: (mask: Blob) => Promise<boolean>
    onClose: () => void
}) {
    const t = useTranslations('editor.codex.imageEditor')
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const drawingRef = useRef<{ pointerId: number; stroke: Stroke } | null>(null)
    const [history, setHistory] = useState<{ strokes: Stroke[]; count: number }>({ strokes: [], count: 0 })
    const [draftStroke, setDraftStroke] = useState<Stroke | null>(null)
    const [brushSize, setBrushSize] = useState(36)
    const [cursor, setCursor] = useState<Point | null>(null)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const disabled = busy || sending

    useLayoutEffect(() => {
        const context = canvasRef.current?.getContext('2d')
        if (!context) return
        context.clearRect(0, 0, width, height)
        paintStrokes(context, [...history.strokes.slice(0, history.count), ...(draftStroke ? [draftStroke] : [])], '#3b82f6')
    }, [width, height, history, draftStroke])

    const position = (event: PointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        setCursor(event.pointerType === 'touch' || x < 0 || x > rect.width || y < 0 || y > rect.height ? null : { x, y })
        return { point: { x: x / rect.width * width, y: y / rect.height * height }, scale: width / rect.width }
    }
    const finishStroke = (event: PointerEvent<HTMLCanvasElement>, cancel = false) => {
        const drawing = drawingRef.current
        if (!drawing || drawing.pointerId !== event.pointerId) return
        drawingRef.current = null
        setDraftStroke(null)
        if (!cancel) {
            setHistory((current) => {
                const strokes = [...current.strokes.slice(0, current.count), drawing.stroke]
                return { strokes, count: strokes.length }
            })
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const send = async () => {
        if (disabled || !history.count || drawingRef.current) return
        setSending(true)
        setError(null)
        try {
            const mask = document.createElement('canvas')
            mask.width = width
            mask.height = height
            const context = mask.getContext('2d')
            if (!context) throw new Error(t('maskExportFailed'))
            context.fillStyle = '#000'
            context.fillRect(0, 0, width, height)
            paintStrokes(context, history.strokes.slice(0, history.count), '#fff')
            const pixels = context.getImageData(0, 0, width, height)
            for (let index = 0; index < pixels.data.length; index += 4) {
                const value = pixels.data[index] >= 128 ? 255 : 0
                pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value
            }
            context.putImageData(pixels, 0, 0)
            const blob = await new Promise<Blob>((resolve, reject) => mask.toBlob((result) => result ? resolve(result) : reject(new Error(t('maskExportFailed'))), 'image/png'))
            if (await onSend(blob)) onClose()
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
            setSending(false)
        }
    }
    return <>
        {toolbar && createPortal(<>
            <button type="button" aria-label={t('undoMask')} disabled={disabled || !history.count || !!draftStroke} onClick={() => setHistory((current) => ({ ...current, count: current.count - 1 }))} className="flex h-7 w-8 items-center justify-center rounded-full hover:bg-accent disabled:opacity-35"><RotateCcw className="h-4 w-4" /></button>
            <button type="button" aria-label={t('redoMask')} disabled={disabled || history.count === history.strokes.length || !!draftStroke} onClick={() => setHistory((current) => ({ ...current, count: current.count + 1 }))} className="flex h-7 w-8 items-center justify-center rounded-full hover:bg-accent disabled:opacity-35"><RotateCw className="h-4 w-4" /></button>
            <button type="button" disabled={disabled || !history.count || !!draftStroke} onClick={() => void send()} className="h-7 rounded-full bg-blue-500 px-3 text-xs text-white disabled:opacity-40">{t('sendMask')}</button>
            <button type="button" aria-label={t('exitMask')} onClick={onClose} className="px-2 text-muted-foreground"><X className="h-4 w-4" /></button>
        </>, toolbar)}
        {brushControls && createPortal(<ImageBrushSize value={brushSize} min={8} max={100} label={t('brushSize')} disabled={disabled} onChange={setBrushSize} />, brushControls)}
        <div className="absolute inset-0 overflow-hidden">
            <canvas ref={canvasRef} width={width} height={height} aria-label={t('maskCanvas')}
                className="absolute inset-0 h-full w-full touch-none opacity-45" style={{ cursor: disabled ? 'default' : 'none' }}
                onPointerDown={(event) => {
                    if (disabled || event.button !== 0 || drawingRef.current) return
                    event.preventDefault()
                    const { point, scale } = position(event)
                    const stroke = { points: [point], width: brushSize * scale }
                    drawingRef.current = { pointerId: event.pointerId, stroke }
                    setDraftStroke(stroke)
                    event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                    const { point } = position(event)
                    const drawing = drawingRef.current
                    if (!drawing || drawing.pointerId !== event.pointerId) return
                    drawing.stroke = { ...drawing.stroke, points: [...drawing.stroke.points, point] }
                    setDraftStroke(drawing.stroke)
                }}
                onPointerUp={(event) => finishStroke(event)}
                onPointerCancel={(event) => finishStroke(event, true)}
                onLostPointerCapture={(event) => finishStroke(event, true)}
                onPointerLeave={() => setCursor(null)} />
            {cursor && !disabled && <div className="pointer-events-none absolute rounded-full border border-white bg-blue-500/15 shadow-[0_0_0_1px_#0005]" style={{ left: cursor.x - brushSize / 2, top: cursor.y - brushSize / 2, width: brushSize, height: brushSize }} />}
        </div>
        {error && <div role="alert" className="absolute inset-x-2 top-2 rounded-lg border bg-background p-2 text-xs text-destructive">{error}</div>}
    </>
}
