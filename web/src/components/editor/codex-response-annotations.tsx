'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, MessageCircle, MessageSquareQuote, Pencil, Trash2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea'
import { cn } from '@/lib/utils'
import type { CodexResponseAnnotation } from '@/lib/codex-response-annotations'
import { captureCodexAnnotation, resolveCodexAnnotationRange } from './codex-annotation-range'

type Anchor = () => DOMRect | null
type AnnotationContextValue = {
    annotations: CodexResponseAnnotation[]
    activeIndex: number | null
    preview: (index: number | null) => void
    add: (annotation: CodexResponseAnnotation) => void
    edit: (index: number, fallback?: HTMLElement) => void
    remove: (index: number) => void
    register: (messageId: string, root: HTMLElement) => () => void
}
const AnnotationContext = createContext<AnnotationContextValue | null>(null)

function FloatingPanel({ anchor, children, className, onPointerEnter, onPointerLeave }: {
    anchor: Anchor
    children: ReactNode
    className?: string
    onPointerEnter?: () => void
    onPointerLeave?: () => void
}) {
    const ref = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const panel = ref.current
        if (!panel) return
        const place = () => {
            const rect = anchor()
            if (!rect) return
            const width = panel.offsetWidth
            const height = panel.offsetHeight
            const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))
            const top = rect.top >= height + 16 ? rect.top - height - 8 : rect.bottom + 8
            panel.style.left = `${left}px`
            panel.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, top))}px`
            panel.style.visibility = 'visible'
        }
        place()
        const observer = new ResizeObserver(place)
        observer.observe(panel)
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
            observer.disconnect()
            window.removeEventListener('resize', place)
            window.removeEventListener('scroll', place, true)
        }
    }, [anchor])
    return createPortal(
        <div ref={ref} data-codex-annotation-ui="" style={{ visibility: 'hidden' }}
            className={cn('fixed z-[100] w-80 max-w-[calc(100vw-1rem)] rounded-2xl border bg-popover text-popover-foreground shadow-lg', className)}
            onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
            {children}
        </div>, document.body
    )
}

function AnnotationHoverCard({ trigger, children, onPreview, className, closeOnClick = false }: {
    trigger: ReactNode
    children: ReactNode
    closeOnClick?: boolean
    onPreview?: (open: boolean) => void
    className?: string
}) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLSpanElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const anchor = useCallback(() => triggerRef.current?.getBoundingClientRect() ?? null, [])
    const cancelTimer = () => { if (timer.current) clearTimeout(timer.current) }
    const close = () => { cancelTimer(); setOpen(false); onPreview?.(false) }
    const show = () => { cancelTimer(); setOpen(true); onPreview?.(true) }
    const leave = () => { cancelTimer(); timer.current = setTimeout(close, 150) }
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
    useEffect(() => {
        if (!open) return
        const outside = (event: PointerEvent) => {
            if (triggerRef.current?.contains(event.target as Node) || panelRef.current?.contains(event.target as Node)) return
            setOpen(false)
            onPreview?.(false)
        }
        document.addEventListener('pointerdown', outside)
        return () => document.removeEventListener('pointerdown', outside)
    }, [open, onPreview])
    return (
        <span ref={triggerRef} className={cn('inline-flex', className)} data-codex-annotation-ui=""
            onPointerEnter={show} onPointerLeave={leave} onFocus={show}
            onBlur={(event) => { if (!panelRef.current?.contains(event.relatedTarget as Node)) leave() }}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
            <span className="inline-flex" onClick={closeOnClick ? close : show}>{trigger}</span>
            {open && <FloatingPanel anchor={anchor} onPointerEnter={show} onPointerLeave={leave} className="w-96">
                <div ref={panelRef} onFocus={show} onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) leave()
                }} onClick={(event) => {
                    if ((event.target as HTMLElement).closest('button')) close()
                }}>{children}</div>
            </FloatingPanel>}
        </span>
    )
}

function AnnotationDetails({ annotation }: { annotation: CodexResponseAnnotation }) {
    const t = useTranslations('editor.codex')
    return <div className="min-w-0 space-y-3 text-sm leading-6">
        <div><div className="text-xs text-muted-foreground">{t('annotationSelectedText')}</div><div className="whitespace-pre-wrap break-words">{annotation.text}</div></div>
        {annotation.annotation && <div><div className="text-xs text-muted-foreground">{t('annotationUserComment')}</div><div className="whitespace-pre-wrap break-words">{annotation.annotation}</div></div>}
    </div>
}

export function ResponseAnnotationSummary({ annotations, editable = false, inverted = false, className }: {
    annotations: CodexResponseAnnotation[] | null | undefined
    editable?: boolean
    inverted?: boolean
    className?: string
}) {
    const t = useTranslations('editor.codex')
    const context = useContext(AnnotationContext)
    if (!annotations?.length) return null
    return <div className={className}>
        <AnnotationHoverCard trigger={<button type="button" className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs',
            inverted ? 'border-current/25 text-inherit' : 'bg-background text-foreground hover:bg-muted'
        )}><MessageSquareQuote className="h-3.5 w-3.5" />{t('annotationCount', { count: annotations.length })}</button>}>
            <ol className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain p-1.5">
                {annotations.map((annotation, index) => <li key={index} className="group flex gap-2 border-b p-3 last:border-b-0 hover:bg-muted/50"
                    onPointerEnter={() => { if (editable) context?.preview(index) }} onPointerLeave={() => { if (editable) context?.preview(null) }}>
                    <span className="pt-0.5 text-sm text-muted-foreground">{index + 1}.</span>
                    <div className="min-w-0 flex-1"><AnnotationDetails annotation={annotation} /></div>
                    {editable && <div className="flex shrink-0 items-start gap-0.5">
                        <button type="button" title={t('editAnnotation')} aria-label={t('editAnnotation')} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={(event) => { context?.edit(index, event.currentTarget) }}><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" title={t('removeAnnotation')} aria-label={t('removeAnnotation')} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => { context?.remove(index) }}><X className="h-3.5 w-3.5" /></button>
                    </div>}
                </li>)}
            </ol>
        </AnnotationHoverCard>
    </div>
}

export function CodexAnnotationReference({ index, annotation }: { index: number; annotation?: CodexResponseAnnotation }) {
    const t = useTranslations('editor.codex')
    const badge = <button type="button" data-codex-annotation-ui="" aria-label={t('annotationNumber', { number: index })} className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500/15 px-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">{index}</button>
    return annotation ? <AnnotationHoverCard trigger={badge}><div className="max-h-[60vh] overflow-auto p-4"><AnnotationDetails annotation={annotation} /></div></AnnotationHoverCard> : badge
}

type AnnotationEditor = { index: number; compact: boolean; comment: string; anchor: Anchor }

export function CodexResponseAnnotationsProvider({ annotations, onChange, children }: {
    annotations: CodexResponseAnnotation[]
    onChange: (annotations: CodexResponseAnnotation[]) => void
    children: ReactNode
}) {
    const t = useTranslations('editor.codex')
    const common = useTranslations('common')
    const roots = useRef(new Map<string, HTMLElement>())
    const [editor, setEditor] = useState<AnnotationEditor | null>(null)
    const [previewIndex, setPreviewIndex] = useState<number | null>(null)
    const editorRef = useRef<HTMLDivElement>(null)
    const editorVisible = editor && annotations[editor.index]
    const register = useCallback((id: string, root: HTMLElement) => {
        roots.current.set(id, root)
        return () => { roots.current.delete(id) }
    }, [])
    const sourceAnchor = (annotation: CodexResponseAnnotation, fallback?: HTMLElement): Anchor => {
        const fallbackRect = fallback?.getBoundingClientRect() ?? null
        return () => {
            const root = annotation.source ? roots.current.get(annotation.source.messageId) : null
            const range = root ? resolveCodexAnnotationRange(root, annotation) : null
            return range?.getClientRects()[0] ?? fallbackRect
        }
    }
    const updateComment = (index: number, comment: string) => {
        onChange(annotations.map((annotation, itemIndex) => {
            if (itemIndex !== index) return annotation
            const next = { ...annotation }
            if (comment.trim()) next.annotation = comment
            else delete next.annotation
            return next
        }))
    }
    const remove = (index: number) => {
        setEditor(null)
        setPreviewIndex(null)
        onChange(annotations.filter((_, itemIndex) => itemIndex !== index))
    }
    useEffect(() => {
        if (!editorVisible) return
        const dismiss = (event: PointerEvent) => {
            if (editorRef.current?.contains(event.target as Node)) return
            setEditor(null)
        }
        document.addEventListener('pointerdown', dismiss)
        return () => document.removeEventListener('pointerdown', dismiss)
    }, [editorVisible])
    const value: AnnotationContextValue = {
        annotations,
        activeIndex: editorVisible ? editor.index : previewIndex,
        preview: setPreviewIndex,
        register,
        remove,
        add: (annotation) => {
            onChange([...annotations, annotation])
            setEditor({ index: annotations.length, compact: true, comment: '', anchor: sourceAnchor(annotation) })
            window.getSelection()?.removeAllRanges()
        },
        edit: (index, fallback) => {
            const annotation = annotations[index]
            if (!annotation) return
            const root = annotation.source ? roots.current.get(annotation.source.messageId) : null
            root?.parentElement?.querySelector(`[data-annotation-index="${index}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest' })
            setEditor({ index, compact: false, comment: annotation.annotation ?? '', anchor: sourceAnchor(annotation, fallback) })
        },
    }
    const save = () => {
        if (editor) updateComment(editor.index, editor.comment.trim())
        setEditor(null)
        setPreviewIndex(null)
    }
    return <AnnotationContext.Provider value={value}>
        {children}
        {editorVisible && <FloatingPanel anchor={editor.anchor} className={editor.compact ? 'w-80 rounded-3xl' : 'w-96 rounded-3xl'}>
            <div ref={editorRef} role="dialog" aria-label={t('editAnnotation')} className={editor.compact ? 'flex items-end gap-2 p-2 pl-4' : 'p-4'}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditor(null) }
                }}>
                {editor.compact ? <>
                    <AutoResizeTextarea autoFocus rows={1} value={editor.comment} aria-label={t('annotationCommentPlaceholder')} placeholder={t('annotationCommentPlaceholder')}
                        className="min-h-8 max-h-[min(16rem,50dvh)] min-w-0 flex-1 overflow-y-auto rounded-none border-0 bg-transparent px-0 py-1.5 text-sm leading-5 shadow-none outline-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:bg-transparent"
                        onChange={(event) => { setEditor({ ...editor, comment: event.target.value }); updateComment(editor.index, event.target.value) }}
                        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); save() } }} />
                    <Button size="icon-sm" className="shrink-0 rounded-full" title={common('save')} aria-label={common('save')} onClick={save}><Check className="h-4 w-4" /></Button>
                </> : <>
                    <textarea autoFocus value={editor.comment} placeholder={t('annotationCommentPlaceholder')} aria-label={t('annotationCommentPlaceholder')}
                        className="min-h-24 w-full resize-y bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground/60"
                        onChange={(event) => setEditor({ ...editor, comment: event.target.value })}
                        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); save() } }} />
                    <div className="mt-3 flex items-center gap-2">
                        <Button variant="ghost" size="icon-sm" aria-label={t('removeAnnotation')} title={t('removeAnnotation')} onClick={() => remove(editor.index)}><Trash2 className="h-4 w-4" /></Button>
                        <div className="flex-1" />
                        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditor(null)}>{common('cancel')}</Button>
                        <Button size="sm" className="rounded-full" onClick={save}>{common('save')}</Button>
                    </div>
                </>}
            </div>
        </FloatingPanel>}
    </AnnotationContext.Provider>
}

type Marker = { index: number; left: number; top: number; rects: { left: number; top: number; width: number; height: number }[] }

export function SelectableCodexResponse({ messageId, children }: { messageId: string; children: ReactNode }) {
    const t = useTranslations('editor.codex')
    const context = useContext(AnnotationContext)
    const contentRef = useRef<HTMLDivElement>(null)
    const [selection, setSelection] = useState<{ annotation: CodexResponseAnnotation; rect: DOMRect } | null>(null)
    const [markers, setMarkers] = useState<Marker[]>([])
    const selectionAnchor = useCallback(() => selection?.rect ?? null, [selection])
    const annotations = context?.annotations
    const register = context?.register
    const ownAnnotations = useMemo(() => (annotations ?? []).map((annotation, index) => ({ annotation, index }))
        .filter(({ annotation }) => annotation.source?.messageId === messageId), [annotations, messageId])
    useEffect(() => {
        if (contentRef.current && register) return register(messageId, contentRef.current)
    }, [messageId, register])
    useLayoutEffect(() => {
        const root = contentRef.current
        if (!root) return
        const measure = () => {
            const box = root.getBoundingClientRect()
            const next: Marker[] = []
            for (const { annotation, index } of ownAnnotations) {
                const range = resolveCodexAnnotationRange(root, annotation)
                const rects = Array.from(range?.getClientRects() ?? []).filter((rect) => rect.width > 0 && rect.height > 0)
                if (!rects.length) continue
                const first = rects[0]
                let left = Math.max(0, Math.min(box.width - 24, first.right - box.left - 12))
                const top = first.top - box.top - 22
                while (next.some((marker) => Math.abs(marker.top - top) < 22 && Math.abs(marker.left - left) < 24) && left >= 24) left -= 26
                next.push({ index, left, top, rects: rects.map((rect) => ({ left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height })) })
            }
            setMarkers(next)
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(root)
        return () => observer.disconnect()
    }, [ownAnnotations, children])
    useEffect(() => {
        if (!selection) return
        const dismiss = () => setSelection(null)
        const changed = () => { if (window.getSelection()?.isCollapsed) dismiss() }
        window.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
        document.addEventListener('selectionchange', changed)
        return () => {
            window.removeEventListener('scroll', dismiss, true)
            window.removeEventListener('resize', dismiss)
            document.removeEventListener('selectionchange', changed)
        }
    }, [selection])
    const capture = () => window.requestAnimationFrame(() => {
        const root = contentRef.current
        const nativeSelection = window.getSelection()
        const annotation = root ? captureCodexAnnotation(root, messageId, nativeSelection) : null
        setSelection(annotation && nativeSelection ? { annotation, rect: nativeSelection.getRangeAt(0).getBoundingClientRect() } : null)
    })
    return <div className="relative" data-codex-response={messageId}>
        <div ref={contentRef} onPointerUp={capture} onKeyUp={capture}>{children}</div>
        {markers.map((marker) => <div key={marker.index} data-codex-annotation-ui="">
            {context?.activeIndex === marker.index && marker.rects.map((rect, index) => <span key={index} className="pointer-events-none absolute rounded-sm bg-blue-500/25" style={rect} />)}
            <span className="absolute z-10" style={{ left: marker.left, top: marker.top }} data-annotation-index={marker.index}>
                <AnnotationHoverCard closeOnClick onPreview={(open) => context?.preview(open ? marker.index : null)} trigger={
                    <button type="button" aria-label={t('annotationNumber', { number: marker.index + 1 })}
                        className="relative flex h-6 min-w-6 items-center justify-center rounded-full bg-blue-500 px-1 text-xs font-semibold text-white shadow-sm after:absolute after:bottom-0 after:left-0 after:h-2 after:w-2 after:rounded-bl-sm after:bg-blue-500"
                        onClick={(event) => context?.edit(marker.index, event.currentTarget)}>{marker.index + 1}</button>
                }><div className="max-h-48 overflow-auto whitespace-pre-wrap break-words p-3 text-sm">{annotations?.[marker.index]?.annotation || t('annotationNoComment')}</div></AnnotationHoverCard>
            </span>
        </div>)}
        {selection && context && <FloatingPanel anchor={selectionAnchor} className="w-auto rounded-xl p-1">
            <Button variant="ghost" size="sm" className="gap-2" onPointerDown={(event) => event.preventDefault()}
                onClick={() => { context.add(selection.annotation); setSelection(null) }}><MessageCircle className="h-4 w-4" />{t('addToChat')}</Button>
        </FloatingPanel>}
    </div>
}
