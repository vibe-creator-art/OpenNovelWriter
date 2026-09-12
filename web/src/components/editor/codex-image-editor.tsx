'use client'

import { createContext, useContext, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, GalleryVerticalEnd, Grid2X2, Pencil, ScanLine, ListChecks, PanelsTopLeft, MessageCirclePlus, Eraser, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ImageMarkupOverlay, type ImageMarkupHandle } from '@/components/editor/codex-image-markup'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { ImageMaskOverlay } from '@/components/editor/codex-image-mask'
import { ImageCommentOverlay } from '@/components/editor/codex-image-comments'
import type { ImagePointComment } from '@/components/image/use-image-attachments'
import { UserImage } from '@/components/image/user-image'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type CodexEditingImage = { id: string; src: string; label: string }

export const REMOVE_IMAGE_BACKGROUND_PROMPT = 'Remove the background from this image. Keep all foreground subjects unchanged and fully intact, with clean, smooth edges. Make the background transparent.'
export const EDITING_IMAGE_ATTACHMENT_PREFIX = 'codex-editing-image:'

export const CodexImageCatalogContext = createContext<((key: string, images: CodexEditingImage[]) => () => void) | null>(null)

export function useCodexImageCatalog(images: CodexEditingImage[]) {
    const register = useContext(CodexImageCatalogContext)
    const key = useId()
    useEffect(() => register?.(key, images), [register, key, images])
}

export const CodexImageEditContext = createContext<((image: CodexEditingImage) => void) | null>(null)

export function CodexImageEditButton({ id, src, label }: CodexEditingImage) {
    const openEditor = useContext(CodexImageEditContext)
    const t = useTranslations('editor.codex.imageEditor')
    if (!openEditor) return null

    return (
        <button
            type="button"
            className="absolute bottom-3 left-3 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-black/55 px-3.5 py-2 text-xs font-medium text-white shadow-sm backdrop-blur-md transition-colors hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={(event) => {
                event.stopPropagation()
                openEditor({ id, src, label })
            }}
        >
            <Pencil className="h-3.5 w-3.5" />
            {t('edit')}
        </button>
    )
}

export type CodexImageEditorHandle = {
    requestLeave: (action: () => void) => void
    exportMarkup: () => Promise<Blob>
    finishMarkup: () => void
}

export function CodexImageEditorCanvas({ ref, onMarkupChange, image, images, selectedImageIds, toolbar, layout, onLayoutChange, comments, commentCount, onSaveComment, onSendComments, onSelect, onRemoveBackground, onResize, onRemoveArea, busy }: {
    ref?: Ref<CodexImageEditorHandle>
    onMarkupChange: (active: boolean) => void
    image: CodexEditingImage
    images: CodexEditingImage[]
    selectedImageIds: string[]
    toolbar: HTMLElement | null
    layout: 'focused' | 'gallery'
    onLayoutChange: (layout: 'focused' | 'gallery', commenting: boolean) => void
    comments: ImagePointComment[]
    commentCount: number
    onSaveComment: (comment: ImagePointComment) => Promise<boolean>
    onSendComments: () => void
    onSelect: (image: CodexEditingImage, mode: 'focus' | 'single' | 'multi') => void
    onRemoveBackground: () => void
    onResize: (ratio: string) => void
    onRemoveArea: (mask: Blob) => Promise<boolean>
    busy: boolean
}) {
    const t = useTranslations('editor.codex.imageEditor')
    const [mode, setMode] = useState<'view' | 'comment' | 'remove' | 'markup'>('view')
    const controlsRef = useRef<HTMLDivElement>(null)
    const [controlsHeight, setControlsHeight] = useState(40)
    useLayoutEffect(() => {
        const controls = controlsRef.current
        if (!controls) return
        const measure = () => setControlsHeight(controls.getBoundingClientRect().height)
        const observer = new ResizeObserver(measure)
        observer.observe(controls)
        measure()
        return () => observer.disconnect()
    }, [])
    const canvasTop = Math.max(64, controlsHeight + 24)
    const markupMode = mode === 'markup'
    const markupRef = useRef<ImageMarkupHandle>(null)
    const [markupToolbar, setMarkupToolbar] = useState<HTMLDivElement | null>(null)
    const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
    const requestLeave = (action: () => void) => {
        if (markupMode) setPendingLeave(() => action)
        else action()
    }
    useEffect(() => {
        onMarkupChange(markupMode)
        return () => onMarkupChange(false)
    }, [markupMode, onMarkupChange])
    useImperativeHandle(ref, () => ({
        requestLeave,
        exportMarkup: () => {
            if (!markupRef.current) return Promise.reject(new Error(t('markupTools.exportFailed')))
            return markupRef.current.exportImage()
        },
        finishMarkup: () => setMode('view'),
    }))
    const commentMode = mode === 'comment'
    const removeMode = mode === 'remove'
    const [maskToolbar, setMaskToolbar] = useState<HTMLDivElement | null>(null)
    const [brushControls, setBrushControls] = useState<HTMLDivElement | null>(null)
    const [multiSelect, setMultiSelect] = useState(false)
    const multiple = images.length > 1
    const gallery = multiple && layout === 'gallery'
    const exitMultiSelect = () => {
        setMultiSelect(false)
        onSelect(image, 'single')
    }
    const isSelected = (item: CodexEditingImage) => gallery && multiSelect ? selectedImageIds.includes(item.id) : item.id === image.id
    const imageButton = (item: CodexEditingImage, index: number) => (
        <button
            key={item.id}
            type="button"
            aria-label={t('selectImage', { number: index + 1 })}
            aria-pressed={isSelected(item)}
            disabled={markupMode && busy}
            onClick={() => item.id === image.id && markupMode ? undefined : requestLeave(() => onSelect(item, gallery ? multiSelect ? 'multi' : 'single' : 'focus'))}
            className={`relative block overflow-hidden rounded-xl border-2 transition-colors ${isSelected(item) ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-muted-foreground/40'}`}
        >
            {gallery && multiSelect && <span className={`absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white shadow-sm ${isSelected(item) ? 'bg-primary text-primary-foreground' : 'bg-black/20'}`}>
                {isSelected(item) && <Check className="h-3 w-3" />}
            </span>}
            <UserImage src={item.src} alt={item.label} className={gallery ? 'h-64 w-auto max-w-full object-contain sm:h-80' : 'h-12 w-12 object-cover'} />
        </button>
    )
    return (
        <section aria-label={t('title')} className="absolute inset-0 overflow-hidden bg-muted/35">
            <div ref={controlsRef} className="absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr] max-sm:flex-wrap">
                <div>
                    {multiple && (
                        <div role="group" aria-label={t('layout')} className="inline-flex rounded-xl border bg-background p-1 shadow-sm">
                            {(['focused', 'gallery'] as const).map((value) => (
                                <button key={value} type="button" aria-label={t(value)} aria-pressed={layout === value} disabled={markupMode && busy} onClick={() => {
                                    if (value === layout) return
                                    requestLeave(() => {
                                        if (value === 'focused' && multiSelect) exitMultiSelect()
                                        if (value === 'gallery') setMode('view')
                                        onLayoutChange(value, commentMode)
                                    })
                                }} className={`flex h-7 w-7 items-center justify-center rounded-lg ${layout === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}>
                                    {value === 'focused' ? <GalleryVerticalEnd className="h-4 w-4" /> : <Grid2X2 className="h-4 w-4" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className={`inline-flex min-w-0 flex-wrap items-center justify-center rounded-full border bg-background p-1 shadow-sm ${!gallery ? 'sm:ml-8' : ''}`}>
                {!gallery && markupMode && <div ref={setMarkupToolbar} />}
                {!gallery && removeMode && <div ref={setMaskToolbar} className="flex items-center" />}
                {!gallery && commentMode && <>
                    <span className="max-w-40 px-2 text-xs text-muted-foreground">{commentCount ? t('commentCount', { count: commentCount }) : t('commentHint')}</span>
                    <button type="button" onClick={onSendComments} disabled={busy || !commentCount} className="h-7 rounded-full bg-foreground px-3 text-xs text-background disabled:opacity-40">{t('sendComments')}</button>
                    <button type="button" aria-label={t('exitComments')} onClick={() => setMode('view')} className="px-2"><X className="h-4 w-4" /></button>
                </>}
                {!gallery && mode === 'view' && <button type="button" onClick={() => setMode('markup')} disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium hover:bg-accent disabled:opacity-50"><Pencil className="h-4 w-4" />{t('markup')}</button>}
                {!gallery && mode === 'view' && <button type="button" onClick={() => setMode('comment')} className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium hover:bg-accent"><MessageCirclePlus className="h-4 w-4" />{t('comment')}</button>}
                {!gallery && mode === 'view' && <button type="button" onClick={onRemoveBackground} disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium hover:bg-accent disabled:opacity-50">
                    <ScanLine className="h-4 w-4" />
                    {t('removeBackground')}
                </button>}
                {!gallery && mode === 'view' && <button type="button" onClick={() => setMode('remove')} disabled={busy} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium hover:bg-accent disabled:opacity-50"><Eraser className="h-4 w-4" />{t('removeArea')}</button>}
                {!gallery && mode === 'view' && <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button type="button" disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium hover:bg-accent data-[state=open]:bg-muted disabled:opacity-50">
                            <PanelsTopLeft className="h-4 w-4" />
                            {t('resize')}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44 rounded-xl p-1" collisionPadding={8}>
                        {([
                            ['square', '1:1', 1],
                            ['portrait', '3:4', 3 / 4],
                            ['story', '9:16', 9 / 16],
                            ['landscape', '4:3', 4 / 3],
                            ['widescreen', '16:9', 16 / 9],
                        ] as const).map(([label, ratio, aspect]) => (
                            <DropdownMenuItem key={ratio} disabled={busy} onSelect={() => onResize(ratio)} className="min-h-9 gap-2 rounded-md text-xs">
                                <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
                                    <span className="rounded-[3px] border-[1.5px] border-current" style={{ width: aspect >= 1 ? 16 : 16 * aspect, height: aspect >= 1 ? 16 / aspect : 16 }} />
                                </span>
                                <span>{t(label)}</span>
                                <span className="ml-auto pl-4 tabular-nums text-muted-foreground">{ratio}</span>
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>}
                {gallery && <button type="button" aria-pressed={multiSelect} onClick={() => multiSelect ? exitMultiSelect() : setMultiSelect(true)} className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium ${multiSelect ? 'bg-muted text-foreground' : 'hover:bg-accent'}`}>
                    <ListChecks className="h-4 w-4" />
                    {t('multiSelect')}
                </button>}
                </div>
            </div>
            {gallery ? (
                <div className="absolute inset-x-0 bottom-0 top-16 overflow-auto overscroll-contain px-4 pb-80 pt-2">
                    <div className="flex flex-wrap items-start gap-3">{images.map(imageButton)}</div>
                </div>
            ) : (
                <>
                    {multiple && <div className="absolute bottom-64 left-3 z-10 space-y-2 overflow-y-auto p-1" style={{ top: canvasTop }}>{images.map(imageButton)}</div>}
                    {(removeMode || markupMode) && <div ref={setBrushControls} className={`absolute bottom-48 top-28 z-10 flex items-center ${multiple ? 'left-20' : 'left-3'}`} />}
                    <div className={`absolute bottom-0 right-0 ${removeMode || markupMode ? multiple ? 'left-28' : 'left-14' : multiple ? 'left-20' : 'left-0'}`} style={{ top: canvasTop }}>
                        <CodexImageViewport key={image.id} image={image} toolbar={toolbar} commentMode={commentMode} comments={comments} onSaveComment={onSaveComment}
                            markupMode={markupMode} markupRef={markupRef} markupToolbar={markupToolbar} onExitMarkup={() => requestLeave(() => {})}
                            removeMode={removeMode} maskToolbar={maskToolbar} brushControls={brushControls} busy={busy} onRemoveArea={onRemoveArea} onExitRemove={() => setMode('view')} />
                    </div>
                </>
            )}
            <AlertDialog open={!!pendingLeave} onOpenChange={(open) => { if (!open) setPendingLeave(null) }}>
                <AlertDialogContent className="gap-5 rounded-2xl p-8 text-center sm:max-w-md">
                    <AlertDialogTitle className="text-xl">{t('markupTools.discardTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('markupTools.discardDescription')}</AlertDialogDescription>
                    <div className="mt-2 flex flex-col gap-3">
                        <AlertDialogCancel className="rounded-full bg-foreground text-background hover:bg-foreground/90 hover:text-background">{t('markupTools.keepEditing')}</AlertDialogCancel>
                        <AlertDialogAction className="rounded-full border border-destructive bg-transparent text-destructive hover:bg-destructive/10" onClick={() => {
                            const action = pendingLeave
                            setPendingLeave(null)
                            setMode('view')
                            action?.()
                        }}>{t('markupTools.discard')}</AlertDialogAction>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    )
}

function CodexImageViewport({ image, toolbar, markupMode, markupRef, markupToolbar, onExitMarkup, commentMode, comments, onSaveComment, removeMode, maskToolbar, brushControls, busy, onRemoveArea, onExitRemove }: {
    markupMode: boolean; markupRef: Ref<ImageMarkupHandle>; markupToolbar: HTMLElement | null; onExitMarkup: () => void
    image: CodexEditingImage; toolbar: HTMLElement | null; commentMode: boolean
    comments: ImagePointComment[]; onSaveComment: (comment: ImagePointComment) => Promise<boolean>
    removeMode: boolean; maskToolbar: HTMLElement | null; brushControls: HTMLElement | null; busy: boolean
    onRemoveArea: (mask: Blob) => Promise<boolean>; onExitRemove: () => void
}) {
    const t = useTranslations('editor.codex.imageEditor')
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const [viewport, setViewport] = useState({ width: 0, height: 0 })
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
    const [zoom, setZoom] = useState('fit')

    useLayoutEffect(() => {
        const element = viewportRef.current
        if (!element) return
        const measure = () => {
            const style = getComputedStyle(element)
            setViewport({
                width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                height: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
            })
        }
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        measure()
        return () => observer.disconnect()
    }, [])

    const ready = imageSize.width > 0 && imageSize.height > 0 && viewport.width > 0 && viewport.height > 0
    const fitScale = ready ? Math.min(viewport.width / imageSize.width, viewport.height / imageSize.height) : 1
    const scale = zoom === 'fit' ? fitScale : Number(zoom) / 100
    const zoomLabel = ready ? `${Math.round(scale * 100)}%` : t('fit')

    return (
        <div className="absolute inset-0 overflow-hidden">
            {toolbar && createPortal(
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label={t('zoom', { value: zoomLabel })}
                            className="inline-flex h-8 min-w-16 items-center justify-center gap-1.5 rounded-full border bg-background/95 px-2.5 text-xs tabular-nums shadow-sm backdrop-blur-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            {zoomLabel}
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-32 rounded-xl p-1" collisionPadding={8}>
                        <DropdownMenuRadioGroup value={zoom} onValueChange={(value) => {
                            setZoom(value)
                            viewportRef.current?.scrollTo({ top: 0, left: 0 })
                        }}>
                            {[25, 50, 100, 150, 200].map((value) => (
                                <DropdownMenuRadioItem key={value} value={String(value)} className="min-h-8 rounded-md text-xs">
                                    {value}%
                                </DropdownMenuRadioItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuRadioItem value="fit" className="min-h-8 rounded-md text-xs">
                                {t('fit')}
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>, toolbar
            )}
            <div ref={viewportRef} className="absolute inset-x-0 bottom-24 top-0 overflow-auto overscroll-contain p-4 sm:px-8">
                <div className="flex min-h-full w-max min-w-full items-start justify-center">
                    <div className="relative shrink-0">
                    <UserImage
                        src={image.src}
                        alt={image.label || t('title')}
                        draggable={false}
                        onLoad={(event) => setImageSize({
                            width: event.currentTarget.naturalWidth,
                            height: event.currentTarget.naturalHeight,
                        })}
                        style={ready ? { width: imageSize.width * scale, height: imageSize.height * scale } : undefined}
                        className="block max-w-none shrink-0 shadow-sm"
                    />
                    {markupMode && imageSize.width > 0 && <ImageMarkupOverlay ref={markupRef} src={image.src} width={imageSize.width} height={imageSize.height} toolbar={markupToolbar} brushControls={brushControls} busy={busy} onClose={onExitMarkup} />}
                    {commentMode && <ImageCommentOverlay comments={comments} onSave={onSaveComment} />}
                    {removeMode && imageSize.width > 0 && <ImageMaskOverlay width={imageSize.width} height={imageSize.height} toolbar={maskToolbar} brushControls={brushControls} busy={busy} onSend={onRemoveArea} onClose={onExitRemove} />}
                    </div>
                </div>
            </div>
        </div>
    )
}

export function CodexImageLatestTurn({ children }: { children: ReactNode }) {
    const t = useTranslations('editor.codex.imageEditor')
    const [expanded, setExpanded] = useState(false)
    const panelId = useId()
    return (
        <div className="mx-4 -mb-3 overflow-hidden rounded-t-[1.4rem] border border-b-0 bg-background/85 pb-3 shadow-sm backdrop-blur-xl">
            <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setExpanded((value) => !value)}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            >
                {t('latestTurn')}
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <div
                id={panelId}
                hidden={!expanded}
                role="region"
                aria-label={t('latestTurn')}
                className="max-h-[min(40dvh,24rem)] overflow-y-auto overscroll-contain px-4 pb-4"
            >
                {expanded && children}
            </div>
        </div>
    )
}
