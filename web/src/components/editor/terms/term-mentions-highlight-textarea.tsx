'use client'

import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { findMentionsInText, getMentionDecoration, toMentionPhraseKey, type TermMentionMatcher } from '@/components/editor/terms/term-mentions-utils'
import { htmlToMarkdown } from '@/lib/html-to-markdown'

type TermMentionsHighlightTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & {
    value: string
    matcher?: TermMentionMatcher | null
    onTermMentionClick?: (termId: string, anchorEl: HTMLElement) => void
    containerClassName?: string
    overlayClassName?: string
    textareaClassName?: string
    autoResize?: boolean
    pasteRichTextAsMarkdown?: boolean
}

function isPointWithinRect(rect: DOMRect, clientX: number, clientY: number) {
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
}

function getMentionElementAtPoint(container: HTMLElement, clientX: number, clientY: number) {
    const mentionElements = container.querySelectorAll<HTMLElement>('[data-term-mention="true"][data-term-id]')

    for (const mentionElement of mentionElements) {
        const rects = Array.from(mentionElement.getClientRects())
        if (rects.some((rect) => isPointWithinRect(rect, clientX, clientY))) {
            return mentionElement
        }
    }

    return null
}

function renderTextWithMentions(
    text: string,
    matcher: TermMentionMatcher | null | undefined,
    onTermMentionClick?: ((termId: string, anchorEl: HTMLElement) => void) | undefined
): ReactNode {
    const regex = matcher?.regex ?? null
    if (!text || !regex || matcher?.tokenByPhraseKey.size === 0) return text

    const matches = findMentionsInText(text, regex)
    if (matches.length === 0) return text

    const parts: ReactNode[] = []
    let cursor = 0

    matches.forEach((match, idx) => {
        const start = Math.max(0, Math.min(text.length, match.start))
        const end = Math.max(start, Math.min(text.length, match.end))

        if (start > cursor) {
            parts.push(<span key={`t-${idx}`}>{text.slice(cursor, start)}</span>)
        }

        const token = matcher?.tokenByPhraseKey.get(toMentionPhraseKey(match.text))
        if (!token) {
            parts.push(<span key={`u-${idx}`}>{text.slice(start, end)}</span>)
        } else {
            const decoration = getMentionDecoration(token)
            parts.push(
                <span
                    key={`m-${idx}`}
                    className={cn(decoration.className, onTermMentionClick && 'cursor-pointer pointer-events-auto')}
                    style={decoration.reactStyle}
                    data-term-id={token.termId}
                    data-term-mention="true"
                    onClick={
                        onTermMentionClick
                            ? (event) => {
                                onTermMentionClick(token.termId, event.currentTarget as unknown as HTMLElement)
                            }
                            : undefined
                    }
                >
                    {text.slice(start, end)}
                </span>
            )
        }

        cursor = end
    })

    if (cursor < text.length) {
        parts.push(<span key="t-end">{text.slice(cursor)}</span>)
    }

    return parts
}

export function TermMentionsHighlightTextarea({
    matcher = null,
    onTermMentionClick,
    containerClassName,
    overlayClassName,
    textareaClassName,
    className,
    value,
    autoResize = true,
    pasteRichTextAsMarkdown = false,
    onScroll,
    onChange,
    onPaste,
    onPointerUp: onPointerUpProp,
    wrap = 'soft',
    ...props
}: TermMentionsHighlightTextareaProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const overlayTextRef = useRef<HTMLDivElement | null>(null)

    const highlighted = useMemo(
        () => renderTextWithMentions(value, matcher, onTermMentionClick),
        [matcher, onTermMentionClick, value]
    )

    const syncOverlayTransform = useCallback(() => {
        const textarea = textareaRef.current
        const overlayText = overlayTextRef.current
        if (!textarea || !overlayText) return
        overlayText.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`
    }, [])

    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current
        if (!textarea) return

        textarea.style.height = 'auto'
        const borderHeight = textarea.offsetHeight - textarea.clientHeight
        textarea.style.height = `${textarea.scrollHeight + borderHeight}px`
    }, [])

    useLayoutEffect(() => {
        if (autoResize) resizeTextarea()
        syncOverlayTransform()
    }, [value, autoResize, resizeTextarea, syncOverlayTransform])

    return (
        <div className={cn('relative w-full min-w-0', containerClassName)}>
            <div
                aria-hidden="true"
                className={cn(
                    'absolute inset-0 min-w-0 max-w-full overflow-hidden pointer-events-none whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
                    className,
                    overlayClassName,
                    'bg-transparent'
                )}
            >
                <div
                    ref={overlayTextRef}
                    className="min-h-full w-full min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                >
                    {highlighted}
                </div>
            </div>

            <textarea
                ref={textareaRef}
                {...props}
                wrap={wrap}
                value={value}
                onScroll={(e) => {
                    syncOverlayTransform()
                    onScroll?.(e)
                }}
                onPaste={(event) => {
                    onPaste?.(event)
                    if (event.defaultPrevented) return
                    if (!pasteRichTextAsMarkdown) return

                    const html = event.clipboardData?.getData('text/html') ?? ''
                    if (!html.trim()) return

                    const markdown = htmlToMarkdown(html)
                    if (!markdown) return

                    const textarea = textareaRef.current
                    if (!textarea) return

                    event.preventDefault()

                    const start = textarea.selectionStart ?? 0
                    const end = textarea.selectionEnd ?? start
                    textarea.focus()
                    textarea.setRangeText(markdown, start, end, 'end')
                    textarea.dispatchEvent(new Event('input', { bubbles: true }))

                    if (autoResize) resizeTextarea()
                    syncOverlayTransform()
                }}
                onPointerUp={(event) => {
                    onPointerUpProp?.(event)

                    const textarea = textareaRef.current
                    const overlayText = overlayTextRef.current
                    if (!textarea) return
                    if (!overlayText) return
                    if (!onTermMentionClick) return
                    const { clientX, clientY, button } = event
                    if (button !== 0) return

                    requestAnimationFrame(() => {
                        const selectionStart = textarea.selectionStart
                        const selectionEnd = textarea.selectionEnd
                        if (selectionStart == null || selectionEnd == null) return
                        if (selectionStart !== selectionEnd) return

                        const mentionElement = getMentionElementAtPoint(overlayText, clientX, clientY)
                        if (!mentionElement) return
                        const termId = mentionElement?.dataset.termId ?? null
                        if (!termId) return

                        onTermMentionClick(termId, mentionElement)
                    })
                }}
                onChange={(e) => {
                    onChange?.(e)
                    if (autoResize) resizeTextarea()
                }}
                className={cn(
                    'relative z-10 w-full min-w-0 max-w-full caret-foreground overflow-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
                    className,
                    textareaClassName,
                    'bg-transparent text-transparent [field-sizing:fixed]'
                )}
            />
        </div>
    )
}
