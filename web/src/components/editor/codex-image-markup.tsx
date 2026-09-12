'use client'

import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Circle, Diamond, Eraser, Heart, Minus, MousePointer2, Redo2, Shapes, Square, PencilLine, Star, Triangle, Type, Undo2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ImageBrushSize } from './codex-image-brush-size'
import { drawMarkup, markupBounds, type MarkupItem, type MarkupPoint, type MarkupShape } from './codex-image-markup-drawing'

export type ImageMarkupHandle = { exportImage: () => Promise<Blob> }
type Tool = 'select' | 'pen' | 'text' | 'eraser' | MarkupShape
type Gesture = { pointerId: number; start: MarkupPoint; item: MarkupItem; points: MarkupPoint[]; handle?: string; moving?: boolean }
const shapes = [['line', Minus], ['arrow', ArrowUpRight], ['rectangle', Square], ['ellipse', Circle], ['triangle', Triangle], ['diamond', Diamond], ['star', Star], ['heart', Heart]] as const
const colors = ['#000000', '#6b7280', '#92400e', '#dc2626', '#f97316', '#f59e0b', '#16a34a', '#0d9488', '#06b6d4', '#2563eb', '#4f46e5', '#9333ea', '#db2777']
const handles = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']

export function ImageMarkupOverlay({ ref, src, width, height, toolbar, brushControls, busy, onClose }: {
    ref: Ref<ImageMarkupHandle>; src: string; width: number; height: number; toolbar: HTMLElement | null; brushControls: HTMLElement | null; busy: boolean; onClose: () => void
}) {
    const t = useTranslations('editor.codex.imageEditor.markupTools')
    const rootRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const gestureRef = useRef<Gesture | null>(null)
    const [history, setHistory] = useState<MarkupItem[][]>([[]])
    const [step, setStep] = useState(0)
    const [tool, setTool] = useState<Tool>('pen')
    const [brushSize, setBrushSize] = useState(3)
    const [eraserSize, setEraserSize] = useState(30)
    const brushTool = tool === 'pen' || tool === 'eraser'
    const toolSize = tool === 'eraser' ? eraserSize : brushSize
    const [color, setColor] = useState('#dc2626')
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [preview, setPreview] = useState<MarkupItem | null>(null)
    const [textEdit, setTextEdit] = useState<MarkupItem | null>(null)
    const [cursor, setCursor] = useState<MarkupPoint | null>(null)
    const [displayScale, setDisplayScale] = useState(1)
    const items = history[step]
    const replaceItem = (list: MarkupItem[], item: MarkupItem) => list.some((entry) => entry.id === item.id) ? list.map((entry) => entry.id === item.id ? item : entry) : [...list, item]
    const visibleItems = textEdit ? replaceItem(items, textEdit) : preview ? replaceItem(items, preview) : items
    const selected = visibleItems.find((item) => item.id === selectedId && item.kind !== 'eraser')
    const commit = (next: MarkupItem[]) => {
        setHistory([...history.slice(0, step + 1), next])
        setStep(step + 1)
        setPreview(null)
    }
    const saveText = () => {
        if (!textEdit) return
        const next = textEdit.text?.trim() ? replaceItem(items, textEdit) : items.filter((item) => item.id !== textEdit.id)
        if (JSON.stringify(items) !== JSON.stringify(next)) commit(next)
        setTextEdit(null)
    }
    const chooseTool = (value: Tool) => {
        saveText()
        setTool(value)
        if (value !== 'select') setSelectedId(null)
        setCursor(null)
    }
    const chooseColor = (value: string) => {
        setColor(value)
        if (textEdit) setTextEdit({ ...textEdit, color: value })
        else if (selected) commit(replaceItem(items, { ...selected, color: value }))
    }
    const undo = () => {
        setTextEdit(null); setPreview(null); setSelectedId(null)
        setStep(Math.max(0, step - 1))
    }
    const redo = () => {
        setTextEdit(null); setPreview(null); setSelectedId(null)
        setStep(Math.min(history.length - 1, step + 1))
    }
    useLayoutEffect(() => {
        const root = rootRef.current
        if (!root) return
        const measure = () => setDisplayScale(root.getBoundingClientRect().width / width)
        const observer = new ResizeObserver(measure)
        observer.observe(root); measure()
        return () => observer.disconnect()
    }, [width])
    useLayoutEffect(() => {
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!context) return
        context.clearRect(0, 0, width, height)
        drawMarkup(context, textEdit ? visibleItems.filter((item) => item.id !== textEdit.id) : visibleItems)
    }, [visibleItems, textEdit, width, height])
    useImperativeHandle(ref, () => ({
        exportImage: async () => {
            const response = await fetch(src)
            if (!response.ok) throw new Error(t('exportFailed'))
            const bitmap = await createImageBitmap(await response.blob())
            try {
                const canvas = document.createElement('canvas')
                canvas.width = width; canvas.height = height
                const context = canvas.getContext('2d')!
                context.drawImage(bitmap, 0, 0, width, height)
                const marks = document.createElement('canvas')
                marks.width = width; marks.height = height
                drawMarkup(marks.getContext('2d')!, visibleItems)
                context.drawImage(marks, 0, 0)
                return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(t('exportFailed'))), 'image/png'))
            } finally { bitmap.close() }
        },
    }))
    const pointAt = (event: ReactPointerEvent) => {
        const rect = rootRef.current!.getBoundingClientRect()
        return { x: Math.max(0, Math.min(width, (event.clientX - rect.left) * width / rect.width)), y: Math.max(0, Math.min(height, (event.clientY - rect.top) * height / rect.height)) }
    }
    const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (busy || event.button !== 0 || gestureRef.current || (event.target as HTMLElement).closest('textarea')) return
        event.preventDefault()
        saveText()
        rootRef.current?.focus({ preventScroll: true })
        const start = pointAt(event)
        const handle = (event.target as HTMLElement).dataset.handle
        if (tool === 'select' || handle) {
            const margin = 6 / displayScale
            const hit = handle ? selected : [...items].reverse().find((item) => item.kind !== 'eraser' && start.x >= item.x - margin && start.x <= item.x + item.width + margin && start.y >= item.y - margin && start.y <= item.y + item.height + margin)
            setSelectedId(hit?.id ?? null)
            if (!hit) return
            gestureRef.current = { pointerId: event.pointerId, start, item: hit, points: [], handle, moving: !handle }
        } else if (tool === 'text') {
            const item: MarkupItem = { id: crypto.randomUUID(), kind: 'text', x: Math.min(start.x, width - Math.min(width, 160 / displayScale)), y: Math.min(start.y, height - 28 / displayScale), width: Math.min(width, 160 / displayScale), height: 28 / displayScale, color, weight: 0, text: '', fontSize: 20 / displayScale }
            setTextEdit(item); setSelectedId(item.id)
            return
        } else {
            gestureRef.current = { pointerId: event.pointerId, start, points: [start], item: { id: crypto.randomUUID(), kind: tool, ...markupBounds(start, start), color, weight: toolSize / displayScale } }
            updateGesture(start)
        }
        event.currentTarget.setPointerCapture(event.pointerId)
    }
    const updateGesture = (point: MarkupPoint) => {
        const gesture = gestureRef.current
        if (!gesture) return
        let item = { ...gesture.item }
        if (gesture.moving) {
            item.x = Math.max(0, Math.min(width - item.width, item.x + point.x - gesture.start.x))
            item.y = Math.max(0, Math.min(height - item.height, item.y + point.y - gesture.start.y))
        } else if (gesture.handle) {
            const { handle } = gesture
            const left = handle.includes('w') ? Math.min(point.x, item.x + item.width - 8 / displayScale) : item.x
            const right = handle.includes('e') ? Math.max(point.x, item.x + 8 / displayScale) : item.x + item.width
            const top = handle.includes('n') ? Math.min(point.y, item.y + item.height - 8 / displayScale) : item.y
            const bottom = handle.includes('s') ? Math.max(point.y, item.y + 8 / displayScale) : item.y + item.height
            item = { ...item, x: left, y: top, width: right - left, height: bottom - top }
            if (item.kind === 'text') item.fontSize = (gesture.item.fontSize ?? 32) * item.height / gesture.item.height
        } else if (item.kind === 'pen' || item.kind === 'eraser') {
            gesture.points.push(point)
            const xs = gesture.points.map((value) => value.x), ys = gesture.points.map((value) => value.y)
            Object.assign(item, markupBounds({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) }))
            item.points = gesture.points.map((value) => ({ x: (value.x - item.x) / item.width, y: (value.y - item.y) / item.height }))
        } else {
            Object.assign(item, markupBounds(gesture.start, point), { reverseX: point.x < gesture.start.x, reverseY: point.y < gesture.start.y })
        }
        setPreview(item)
        return item
    }
    const finish = (event: ReactPointerEvent<HTMLDivElement>, cancel = false) => {
        const gesture = gestureRef.current
        if (!gesture || gesture.pointerId !== event.pointerId) return
        const item = cancel ? null : updateGesture(pointAt(event))
        gestureRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        if (!item) { setPreview(null); return }
        if (JSON.stringify(item) !== JSON.stringify(items.find((entry) => entry.id === item.id))) commit(replaceItem(items, item))
        else setPreview(null)
        if (!['pen', 'eraser'].includes(item.kind)) { setSelectedId(item.id); setTool('select') }
    }
    const toolbarButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:opacity-35'
    return <>
        {brushControls && brushTool && createPortal(<ImageBrushSize value={toolSize} min={tool === 'eraser' ? 8 : 1} max={tool === 'eraser' ? 100 : 40} label={t(tool === 'eraser' ? 'eraserSize' : 'brushSize')} disabled={busy} onChange={tool === 'eraser' ? setEraserSize : setBrushSize} />, brushControls)}
        {toolbar && createPortal(<div role="toolbar" aria-label={t('toolbar')} className="flex flex-wrap items-center justify-center gap-0.5">
            {([['select', MousePointer2], ['pen', PencilLine], ['text', Type]] as const).map(([value, Icon]) => <button key={value} type="button" aria-label={t(value)} title={t(value)} aria-pressed={tool === value} disabled={busy} onClick={() => chooseTool(value)} className={`${toolbarButton} ${tool === value ? 'bg-muted' : ''}`}><Icon className="h-4 w-4" /></button>)}
            <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" aria-label={t('shapes')} title={t('shapes')} disabled={busy} className={`${toolbarButton} data-[state=open]:bg-muted ${shapes.some(([kind]) => kind === tool) ? 'bg-muted' : ''}`}><Shapes className="h-4 w-4" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="grid min-w-0 grid-cols-4 gap-1 rounded-2xl p-2" collisionPadding={8}>
                    {shapes.map(([kind, Icon]) => <DropdownMenuItem key={kind} asChild onSelect={() => chooseTool(kind)} className="p-0"><button type="button" aria-label={t(kind)} title={t(kind)} className={`${toolbarButton} ${tool === kind ? 'bg-muted' : ''}`}><Icon className="h-4 w-4" /></button></DropdownMenuItem>)}
                </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" aria-label={t('color')} title={t('color')} disabled={busy} className={`${toolbarButton} data-[state=open]:bg-muted`}><span className="h-5 w-5 rounded-full border border-black/15 shadow-sm" style={{ background: selected?.color ?? color }} /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="grid min-w-0 grid-cols-7 gap-1 rounded-2xl p-2" collisionPadding={8}>
                    <label title={t('customColor')} className="relative m-1 h-6 w-6 overflow-hidden rounded-full" style={{ background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' }}><input aria-label={t('customColor')} type="color" value={color} onChange={(event) => chooseColor(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" /></label>
                    {colors.map((value) => <button key={value} type="button" aria-label={t('colorValue', { value })} aria-pressed={(selected?.color ?? color) === value} onClick={() => chooseColor(value)} className={`m-1 h-6 w-6 rounded-full border border-black/15 shadow-sm ${(selected?.color ?? color) === value ? 'outline-2 outline-offset-2 outline-blue-500' : ''}`} style={{ background: value }} />)}
                </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" aria-label={t('eraser')} title={t('eraser')} aria-pressed={tool === 'eraser'} disabled={busy} onClick={() => chooseTool('eraser')} className={`${toolbarButton} ${tool === 'eraser' ? 'bg-muted' : ''}`}><Eraser className="h-4 w-4" /></button>
            <span className="mx-1 h-4 border-l" />
            <button type="button" aria-label={t('undo')} title={t('undo')} disabled={busy || step === 0} onClick={undo} className={toolbarButton}><Undo2 className="h-4 w-4" /></button>
            <button type="button" aria-label={t('redo')} title={t('redo')} disabled={busy || step === history.length - 1} onClick={redo} className={toolbarButton}><Redo2 className="h-4 w-4" /></button>
            <span className="mx-1 h-4 border-l" />
            <button type="button" aria-label={t('exit')} title={t('exit')} disabled={busy} onClick={onClose} className={toolbarButton}><X className="h-4 w-4" /></button>
        </div>, toolbar)}
        <div ref={rootRef} tabIndex={0} role="application" aria-label={t('canvas')} className="absolute inset-0 touch-none outline-none" style={{ cursor: busy ? 'wait' : tool === 'select' ? 'default' : brushTool ? 'none' : tool === 'text' ? 'text' : 'crosshair' }}
            onPointerDown={begin} onPointerMove={(event) => { const point = pointAt(event); setCursor(point); if (gestureRef.current?.pointerId === event.pointerId) updateGesture(point) }}
            onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => finish(event, true)} onPointerLeave={() => setCursor(null)}
            onDoubleClick={(event) => {
                if (busy || tool !== 'select' || !selected || selected.kind !== 'text') return
                event.preventDefault(); setTextEdit(selected)
            }}
            onKeyDown={(event) => {
                if ((event.target as HTMLElement).closest('textarea') || busy) return
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
                else if (selectedId && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); commit(items.filter((item) => item.id !== selectedId)); setSelectedId(null) }
                else if (event.key === 'Escape') { event.preventDefault(); onClose() }
            }}>
            <canvas ref={canvasRef} width={width} height={height} className="pointer-events-none absolute inset-0 h-full w-full" />
            {selected && <div className="pointer-events-none absolute border border-dashed border-blue-500" style={{ left: `${selected.x / width * 100}%`, top: `${selected.y / height * 100}%`, width: `${selected.width / width * 100}%`, height: `${selected.height / height * 100}%` }}>
                {!textEdit && handles.map((handle) => <span key={handle} data-handle={handle} aria-label={t('resizeHandle', { handle })} className="pointer-events-auto absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 border border-blue-500 bg-white" style={{ left: handle.includes('w') ? '0%' : handle.includes('e') ? '100%' : '50%', top: handle.includes('n') ? '0%' : handle.includes('s') ? '100%' : '50%', cursor: `${handle}-resize` }} />)}
            </div>}
            {textEdit && <textarea autoFocus aria-label={t('textInput')} value={textEdit.text} disabled={busy} onChange={(event) => {
                const fontSize = textEdit.fontSize ?? 32
                const lines = Math.max(1, Math.ceil(event.currentTarget.scrollHeight / (fontSize * displayScale * 1.2)))
                setTextEdit({ ...textEdit, text: event.target.value, height: Math.max(28 / displayScale, lines * fontSize * 1.2) })
            }} onBlur={saveText} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { setTextEdit(null); setSelectedId(null) } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); saveText(); setTool('select'); requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true })) } }}
                className="absolute resize-none overflow-hidden border border-dashed border-blue-500 bg-transparent p-0 outline-none" style={{ left: `${textEdit.x / width * 100}%`, top: `${textEdit.y / height * 100}%`, width: `${textEdit.width / width * 100}%`, height: `${textEdit.height / height * 100}%`, color: textEdit.color, font: `${(textEdit.fontSize ?? 32) * displayScale}px/1.2 sans-serif` }} />}
            {brushTool && cursor && !busy && <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/70 shadow-[0_0_0_1px_white]" style={{ left: `${cursor.x / width * 100}%`, top: `${cursor.y / height * 100}%`, width: toolSize, height: toolSize, background: tool === 'pen' ? `${color}40` : undefined }} />}
        </div>
    </>
}
