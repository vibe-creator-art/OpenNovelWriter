'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, MessageCircle, MessageCirclePlus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ImagePointComment, PendingImageAttachment } from '@/components/image/use-image-attachments'

export const COMMENT_IMAGE_ATTACHMENT_PREFIX = 'codex-comment-image:'

export function formatImageComments(items: PendingImageAttachment[]) {
    return items.filter((item) => item.status === 'ready' && item.url).flatMap((item, index) =>
        item.comments?.length ? [`Image ${index + 1}:\n${item.comments.map((comment, number) =>
            `${number + 1}. (x: ${comment.x.toFixed(1)}%, y: ${comment.y.toFixed(1)}%) ${comment.text}`
        ).join('\n')}`] : []
    ).join('\n\n')
}

const commentCursor = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M24 13a10 10 0 0 1-10 10 11 11 0 0 1-5-1l-6 2 2-6a10 10 0 1 1 19-5Z" fill="#2f6bcb" stroke="white" stroke-width="2"/></svg>')}") 4 24, crosshair`

export function ImageCommentOverlay({ comments, onSave }: {
    comments: ImagePointComment[]
    onSave: (comment: ImagePointComment) => Promise<boolean>
}) {
    const t = useTranslations('editor.codex.imageEditor')
    const surfaceRef = useRef<HTMLDivElement>(null)
    const [draft, setDraft] = useState<ImagePointComment | null>(null)
    const [saving, setSaving] = useState(false)
    const [position, setPosition] = useState({ left: 0, top: 0, width: 320 })
    const editorRef = useRef<HTMLFormElement>(null)
    useLayoutEffect(() => {
        if (!draft) return
        const place = () => {
            const rect = surfaceRef.current?.getBoundingClientRect()
            if (!rect) return
            const width = Math.min(320, window.innerWidth - 24)
            const x = rect.left + rect.width * draft.x / 100
            const y = rect.top + rect.height * draft.y / 100
            const height = editorRef.current?.offsetHeight ?? 64
            setPosition({
                width,
                left: Math.max(12, Math.min(x + 22, window.innerWidth - width - 12)),
                top: Math.max(12, Math.min(y - height / 2, window.innerHeight - height - 12)),
            })
        }
        const observer = new ResizeObserver(place)
        if (surfaceRef.current) observer.observe(surfaceRef.current)
        if (editorRef.current) observer.observe(editorRef.current)
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        place()
        return () => {
            observer.disconnect()
            window.removeEventListener('resize', place)
            window.removeEventListener('scroll', place, true)
        }
    }, [draft])

    const save = async () => {
        if (!draft?.text.trim() || saving) return
        setSaving(true)
        try {
            if (await onSave({ ...draft, text: draft.text.trim() })) setDraft(null)
        } finally {
            setSaving(false)
        }
    }
    const marker = (comment: ImagePointComment, number: number) => (
        <button key={comment.id} type="button" aria-label={t('commentNumber', { number })} title={comment.text}
            style={{ left: `${comment.x}%`, top: `${comment.y}%` }}
            className="absolute z-10 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center text-white drop-shadow-sm"
            onClick={() => { if (!saving) setDraft(comment) }}>
            <MessageCircle className="absolute h-8 w-8 fill-[#2f6bcb] stroke-white stroke-2" />
            <span className="relative text-xs font-semibold">{number}</span>
        </button>
    )
    return <div ref={surfaceRef} className="absolute inset-0">
        <button type="button" aria-label={t('addCommentOnImage')} className="absolute inset-0 h-full w-full focus-visible:outline-2 focus-visible:outline-primary"
            style={{ cursor: commentCursor }} disabled={saving}
            onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setDraft({ id: crypto.randomUUID(), x: event.detail ? Math.min(100, Math.max(0, (event.clientX - rect.left) / rect.width * 100)) : 50,
                    y: event.detail ? Math.min(100, Math.max(0, (event.clientY - rect.top) / rect.height * 100)) : 50, text: '' })
            }} />
        {comments.map((comment, index) => marker(comment, index + 1))}
        {draft && !comments.some((comment) => comment.id === draft.id) && marker(draft, comments.length + 1)}
        {draft && createPortal(<form ref={editorRef} role="dialog" aria-label={t('commentEditor')}
            style={position} className="fixed z-[60] flex items-center gap-2 rounded-2xl border bg-background p-2 shadow-lg"
            onSubmit={(event) => { event.preventDefault(); void save() }}>
            <AutoResizeTextarea key={draft.id} autoFocus aria-label={t('commentText')} placeholder={t('commentText')}
                value={draft.text} disabled={saving} className="min-h-9 max-h-[min(16rem,50dvh)] flex-1 overflow-y-auto border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') { event.preventDefault(); setDraft(null) }
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void save() }
                }} />
            <button type="submit" aria-label={t('saveComment')} disabled={saving || !draft.text.trim()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>
            <button type="button" aria-label={t('cancelComment')} disabled={saving} onClick={() => setDraft(null)} className="p-1 text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
        </form>, document.body)}
    </div>
}

export function ImageCommentSummary({ items, onRemove }: { items: PendingImageAttachment[]; onRemove: () => void }) {
    const t = useTranslations('editor.codex.imageEditor')
    const count = items.reduce((total, item) => total + (item.comments?.length ?? 0), 0)
    if (!count) return null
    return <div className="inline-flex items-center rounded-xl border bg-background p-1">
        <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className="inline-flex items-center gap-2 px-2 py-1.5 text-xs"><MessageCirclePlus className="h-4 w-4" />{t('commentCount', { count })}</button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="max-h-64 w-72 overflow-y-auto rounded-xl p-3" collisionPadding={12}>
                {items.filter((item) => item.status === 'ready' && item.url).map((item, index) => item.comments?.length ? <div key={item.id} className="mb-3 last:mb-0">
                    <div className="mb-2 text-sm font-medium">{t('commentImage', { number: index + 1 })}</div>
                    <ol className="ml-4 list-decimal space-y-2 text-xs">{item.comments.map((comment) => <li key={comment.id} className="whitespace-pre-wrap break-words pl-1">{comment.text}</li>)}</ol>
                </div> : null)}
            </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" aria-label={t('removeComments')} onClick={onRemove} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
    </div>
}
