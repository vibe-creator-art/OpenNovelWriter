'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'

type PromptTemplateInsertRequest = {
    id: number
    text: string
}

type PromptTemplateEditorProps = {
    value: string
    onChange: (value: string) => void
    disabled?: boolean
    placeholder?: string
    className?: string
    insertRequest?: PromptTemplateInsertRequest | null
    onEditorFocus?: () => void
}

type FindOptions = {
    matchCase: boolean
    regex: boolean
    wholeWord: boolean
}

type FindMatch = { start: number; end: number }

const LINE_HEIGHT_PX = 24

function isQuote(char: string) {
    return char === '"' || char === '\''
}

function isWordChar(char: string | undefined) {
    if (!char) return false
    return /[A-Za-z0-9_]/.test(char)
}

function computeLineStarts(text: string): number[] {
    const starts = [0]
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') starts.push(i + 1)
    }
    return starts
}

function findLineIndex(lineStarts: number[], pos: number) {
    if (lineStarts.length === 0) return 0
    const clamped = Math.max(0, Math.min(pos, Number.MAX_SAFE_INTEGER))
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const start = lineStarts[mid] ?? 0
        const nextStart = lineStarts[mid + 1] ?? Number.MAX_SAFE_INTEGER
        if (clamped < start) {
            hi = mid - 1
            continue
        }
        if (clamped >= nextStart) {
            lo = mid + 1
            continue
        }
        return mid
    }
    return Math.max(0, Math.min(lineStarts.length - 1, lo))
}

function arraysEqual(a: number[], b: number[]) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

function computeLineOffsets(lineHeights: number[], count: number) {
    const offsets = new Array<number>(count)
    let offset = 0
    for (let i = 0; i < count; i += 1) {
        offsets[i] = offset
        offset += lineHeights[i] ?? LINE_HEIGHT_PX
    }
    return offsets
}

function findAllMatches(text: string, query: string, options: FindOptions): FindMatch[] {
    const trimmed = query.trim()
    if (!trimmed) return []

    const matches: FindMatch[] = []
    const maxMatches = 5000

    if (options.regex) {
        try {
            const flags = `g${options.matchCase ? '' : 'i'}`
            const re = new RegExp(trimmed, flags)
            let m: RegExpExecArray | null
            while ((m = re.exec(text)) !== null) {
                const value = m[0] ?? ''
                if (!value) {
                    re.lastIndex += 1
                    continue
                }
                const start = m.index
                const end = start + value.length
                if (options.wholeWord) {
                    const before = text[start - 1]
                    const after = text[end]
                    if (isWordChar(before) || isWordChar(after)) continue
                }
                matches.push({ start, end })
                if (matches.length >= maxMatches) break
            }
        } catch {
            return []
        }
        return matches
    }

    const haystack = options.matchCase ? text : text.toLowerCase()
    const needle = options.matchCase ? trimmed : trimmed.toLowerCase()

    let i = 0
    while (i <= haystack.length) {
        const idx = haystack.indexOf(needle, i)
        if (idx < 0) break
        const start = idx
        const end = idx + needle.length
        if (options.wholeWord) {
            const before = text[start - 1]
            const after = text[end]
            if (isWordChar(before) || isWordChar(after)) {
                i = start + 1
                continue
            }
        }
        matches.push({ start, end })
        if (matches.length >= maxMatches) break
        i = end
    }

    return matches
}

type NunjucksTokenKind = 'expr' | 'stmt' | 'comment'

type LineToken =
    | { kind: 'text'; text: string }
    | { kind: 'nunjucks'; tokenKind: NunjucksTokenKind; open: string; close: string; inner: string }
    | { kind: 'tag'; text: string }

function parseNunjucksToken(
    line: string,
    start: number,
    config: { tokenKind: NunjucksTokenKind; open: '{{' | '{%' | '{#'; close: '}}' | '%}' | '#}' }
): { token: Extract<LineToken, { kind: 'nunjucks' }>; nextIndex: number } | null {
    const { open, close, tokenKind } = config
    if (!line.startsWith(open, start)) return null

    let innerStart = start + open.length
    let openText = open
    if (line[innerStart] === '-') {
        innerStart += 1
        openText += '-'
    }

    let quote: '"' | "'" | null = null
    let escaped = false
    let index = innerStart

    for (; index < line.length; index += 1) {
        const current = line[index]!

        if (quote) {
            if (escaped) {
                escaped = false
                continue
            }
            if (current === '\\') {
                escaped = true
                continue
            }
            if (current === quote) quote = null
            continue
        }

        if (isQuote(current)) {
            quote = current
            continue
        }

        if (current === '-' && line.startsWith(close, index + 1)) {
            return {
                token: {
                    kind: 'nunjucks',
                    tokenKind,
                    open: openText,
                    close: `-${close}`,
                    inner: line.slice(innerStart, index),
                },
                nextIndex: index + 1 + close.length,
            }
        }

        if (line.startsWith(close, index)) {
            return {
                token: {
                    kind: 'nunjucks',
                    tokenKind,
                    open: openText,
                    close,
                    inner: line.slice(innerStart, index),
                },
                nextIndex: index + close.length,
            }
        }
    }

    return null
}

function tokenizePromptLine(line: string): LineToken[] {
    const tokens: LineToken[] = []
    let buffer = ''

    const flush = () => {
        if (!buffer) return
        tokens.push({ kind: 'text', text: buffer })
        buffer = ''
    }

    let i = 0
    while (i < line.length) {
        const exprToken = parseNunjucksToken(line, i, { tokenKind: 'expr', open: '{{', close: '}}' })
        const stmtToken = parseNunjucksToken(line, i, { tokenKind: 'stmt', open: '{%', close: '%}' })
        const commentToken = parseNunjucksToken(line, i, { tokenKind: 'comment', open: '{#', close: '#}' })
        const nunjucksToken = exprToken ?? stmtToken ?? commentToken

        if (nunjucksToken) {
            flush()
            tokens.push(nunjucksToken.token)
            i = nunjucksToken.nextIndex
            continue
        }

        if (line[i] === '<') {
            const tail = line.slice(i)
            const match = /^<\/?[A-Za-z][A-Za-z0-9_-]*(?:\s[^>]*?)?>/.exec(tail)
            if (match?.[0]) {
                flush()
                tokens.push({ kind: 'tag', text: match[0] })
                i += match[0].length
                continue
            }
        }

        buffer += line[i]
        i += 1
    }

    flush()
    return tokens
}

const NUNJUCKS_STATEMENT_KEYWORDS = new Set([
    'if', 'elif', 'else', 'endif', 'for', 'endfor', 'include', 'set', 'endset', 'macro', 'endmacro',
    'import', 'from', 'block', 'endblock', 'extends', 'with', 'endwith', 'filter', 'endfilter', 'raw', 'endraw',
])

const NUNJUCKS_EXPRESSION_KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'true', 'false', 'none'])

function isNunjucksKeyword(value: string, tokenKind: NunjucksTokenKind) {
    const lowered = value.toLowerCase()
    return tokenKind === 'stmt'
        ? NUNJUCKS_STATEMENT_KEYWORDS.has(lowered)
        : NUNJUCKS_EXPRESSION_KEYWORDS.has(lowered)
}

function highlightNunjucksInner(inner: string, tokenKind: NunjucksTokenKind): ReactNode[] {
    if (tokenKind === 'comment') {
        return [
            <span key="comment" className="text-zinc-500 dark:text-zinc-400 italic">
                {inner}
            </span>,
        ]
    }

    const nodes: ReactNode[] = []
    let i = 0
    let key = 0

    while (i < inner.length) {
        const ch = inner[i]

        if (isQuote(ch)) {
            const quote = ch
            let j = i + 1
            let escaped = false
            for (; j < inner.length; j++) {
                const c = inner[j]
                if (escaped) {
                    escaped = false
                    continue
                }
                if (c === '\\') {
                    escaped = true
                    continue
                }
                if (c === quote) {
                    j += 1
                    break
                }
            }
            const str = inner.slice(i, j)
            nodes.push(
                <span key={`s-${key++}`} className="text-emerald-700 dark:text-emerald-400">
                    {str}
                </span>
            )
            i = j
            continue
        }

        if (/[A-Za-z_]/.test(ch)) {
            let j = i + 1
            while (j < inner.length && /[A-Za-z0-9_]/.test(inner[j]!)) j += 1

            while (inner[j] === '.' && /[A-Za-z_]/.test(inner[j + 1] ?? '')) {
                j += 2
                while (j < inner.length && /[A-Za-z0-9_]/.test(inner[j]!)) j += 1
            }

            const ident = inner.slice(i, j)
            let lookahead = j
            while (lookahead < inner.length && /\s/.test(inner[lookahead]!)) lookahead += 1
            const isFunction = inner[lookahead] === '(' && !ident.includes('.')
            const isKeyword = isNunjucksKeyword(ident, tokenKind)

            nodes.push(
                <span
                    key={`i-${key++}`}
                    className={cn(
                        isKeyword
                            ? 'text-amber-700 dark:text-amber-400 font-medium'
                            : isFunction
                                ? 'text-violet-700 dark:text-violet-400'
                                : ident.includes('.')
                                    ? 'text-sky-700 dark:text-sky-400'
                                    : 'text-foreground'
                    )}
                >
                    {ident}
                </span>
            )
            i = j
            continue
        }

        nodes.push(<span key={`c-${key++}`}>{ch}</span>)
        i += 1
    }

    return nodes
}

function highlightPromptLine(line: string): ReactNode[] {
    const tokens = tokenizePromptLine(line)
    const nodes: ReactNode[] = []
    let key = 0

    for (const token of tokens) {
        if (token.kind === 'text') {
            nodes.push(<span key={`t-${key++}`}>{token.text}</span>)
            continue
        }

        if (token.kind === 'tag') {
            const name = /^<\/?([A-Za-z][A-Za-z0-9_-]*)/.exec(token.text)?.[1]?.toLowerCase() ?? ''
            const tagColor =
                name === 'bad'
                    ? 'text-rose-700 dark:text-rose-400'
                    : name === 'good'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-indigo-700 dark:text-indigo-400'
            nodes.push(
                <span key={`g-${key++}`} className={tagColor}>
                    {token.text}
                </span>
            )
            continue
        }

        const delimiterColor =
            token.tokenKind === 'expr'
                ? 'text-sky-700 dark:text-sky-400'
                : token.tokenKind === 'stmt'
                    ? 'text-violet-700 dark:text-violet-400'
                    : 'text-zinc-500 dark:text-zinc-400'

        nodes.push(
            <span key={`o-${key++}`} className={delimiterColor}>
                {token.open}
            </span>
        )
        nodes.push(...highlightNunjucksInner(token.inner, token.tokenKind).map((node) => <span key={`x-${key++}`}>{node}</span>))
        nodes.push(
            <span key={`c-${key++}`} className={delimiterColor}>
                {token.close}
            </span>
        )
    }

    return nodes
}

export function PromptTemplateEditor({
    value,
    onChange,
    disabled = false,
    placeholder,
    className,
    insertRequest = null,
    onEditorFocus,
}: PromptTemplateEditorProps) {
    const t = useTranslations('prompts')
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const overlayViewportRef = useRef<HTMLDivElement | null>(null)
    const overlayRef = useRef<HTMLDivElement | null>(null)
    const gutterRef = useRef<HTMLDivElement | null>(null)
    const findInputRef = useRef<HTMLInputElement | null>(null)
    const contentRef = useRef<HTMLDivElement | null>(null)
    const lineRefs = useRef<Array<HTMLDivElement | null>>([])

    const [selectionStart, setSelectionStart] = useState(0)
    const selectionRangeRef = useRef({ start: 0, end: 0 })
    const handledInsertRequestIdRef = useRef<number | null>(null)
    const [findQuery, setFindQuery] = useState('')
    const [findOptions, setFindOptions] = useState<FindOptions>({
        matchCase: false,
        regex: false,
        wholeWord: false,
    })
    const [activeMatchIndex, setActiveMatchIndex] = useState(-1)
    const [lineHeights, setLineHeights] = useState<number[]>([])

    const lineStarts = useMemo(() => computeLineStarts(value), [value])
    const lines = useMemo(() => value.split('\n'), [value])
    const activeLine = useMemo(() => findLineIndex(lineStarts, selectionStart), [lineStarts, selectionStart])
    const matches = useMemo(() => findAllMatches(value, findQuery, findOptions), [value, findQuery, findOptions])
    const resolvedLineHeights = useMemo(
        () => lines.map((_, index) => lineHeights[index] ?? LINE_HEIGHT_PX),
        [lineHeights, lines]
    )
    const lineOffsets = useMemo(
        () => computeLineOffsets(resolvedLineHeights, lines.length),
        [resolvedLineHeights, lines.length]
    )

    const setLineRef = useCallback((index: number, node: HTMLDivElement | null) => {
        lineRefs.current[index] = node
    }, [])

    const measureLineHeights = useCallback(() => {
        const next = lines.map((_, index) => {
            const node = lineRefs.current[index]
            return Math.max(LINE_HEIGHT_PX, Math.round(node?.getBoundingClientRect().height ?? LINE_HEIGHT_PX))
        })
        setLineHeights((prev) => (arraysEqual(prev, next) ? prev : next))
    }, [lines])

    const syncOverlayViewport = useCallback(() => {
        const textarea = textareaRef.current
        const overlayViewport = overlayViewportRef.current
        if (!textarea || !overlayViewport) return

        overlayViewport.style.width = `${textarea.clientWidth}px`
    }, [])

    const syncTransforms = useCallback(() => {
        const textarea = textareaRef.current
        if (!textarea) return

        const overlay = overlayRef.current
        if (overlay) {
            overlay.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`
        }

        const gutter = gutterRef.current
        if (gutter) {
            gutter.style.transform = `translateY(${-textarea.scrollTop}px)`
        }
    }, [])

    useLayoutEffect(() => {
        lineRefs.current.length = lines.length
        syncOverlayViewport()
        measureLineHeights()
        syncTransforms()
    }, [lines.length, measureLineHeights, syncOverlayViewport, syncTransforms, value])

    useEffect(() => {
        const node = contentRef.current
        if (!node || typeof ResizeObserver === 'undefined') return

        let frame = 0
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                syncOverlayViewport()
                measureLineHeights()
                syncTransforms()
            })
        })

        observer.observe(node)
        return () => {
            observer.disconnect()
            cancelAnimationFrame(frame)
        }
    }, [measureLineHeights, syncOverlayViewport, syncTransforms])

    const syncSelection = useCallback(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        const start = textarea.selectionStart ?? 0
        const end = textarea.selectionEnd ?? start
        selectionRangeRef.current = { start, end }
        setSelectionStart(start)
    }, [])

    const ensureLineVisible = useCallback((lineIndex: number) => {
        const textarea = textareaRef.current
        if (!textarea) return

        const top = lineOffsets[lineIndex] ?? 0
        const bottom = top + (resolvedLineHeights[lineIndex] ?? LINE_HEIGHT_PX)
        const viewTop = textarea.scrollTop
        const viewBottom = viewTop + textarea.clientHeight

        if (top < viewTop) textarea.scrollTop = top
        else if (bottom > viewBottom) textarea.scrollTop = Math.max(0, bottom - textarea.clientHeight)
    }, [lineOffsets, resolvedLineHeights])

    const focusFind = useCallback(() => {
        if (disabled) return
        findInputRef.current?.focus()
        findInputRef.current?.select()
    }, [disabled])

    const focusEditor = useCallback(() => {
        textareaRef.current?.focus()
        syncSelection()
    }, [syncSelection])

    const setCaretToMatch = useCallback(
        (matchIndex: number) => {
            const textarea = textareaRef.current
            if (!textarea) return
            if (matches.length === 0) return

            const index = ((matchIndex % matches.length) + matches.length) % matches.length
            const match = matches[index]!
            textarea.focus()
            textarea.setSelectionRange(match.start, match.end)
            selectionRangeRef.current = { start: match.start, end: match.end }
            setSelectionStart(match.start)
            setActiveMatchIndex(index)
            ensureLineVisible(findLineIndex(lineStarts, match.start))
            syncTransforms()
        },
        [ensureLineVisible, lineStarts, matches, syncTransforms]
    )

    const handleFindNext = useCallback(() => {
        if (matches.length === 0) return
        setCaretToMatch(activeMatchIndex < 0 ? 0 : activeMatchIndex + 1)
    }, [activeMatchIndex, matches.length, setCaretToMatch])

    const handleFindPrev = useCallback(() => {
        if (matches.length === 0) return
        setCaretToMatch(activeMatchIndex < 0 ? matches.length - 1 : activeMatchIndex - 1)
    }, [activeMatchIndex, matches.length, setCaretToMatch])

    const handleLineNumberClick = useCallback(
        (lineIndex: number) => {
            const textarea = textareaRef.current
            if (!textarea) return
            const start = lineStarts[lineIndex] ?? 0
            textarea.focus()
            textarea.setSelectionRange(start, start)
            selectionRangeRef.current = { start, end: start }
            setSelectionStart(start)
            ensureLineVisible(lineIndex)
            syncTransforms()
        },
        [ensureLineVisible, lineStarts, syncTransforms]
    )

    const handleTabIndent = useCallback(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        if (disabled) return

        const start = textarea.selectionStart ?? 0
        const end = textarea.selectionEnd ?? 0
        const insert = '\t'

        textarea.focus()
        textarea.setRangeText(insert, start, end, 'end')

        const nextValue = textarea.value
        const pos = textarea.selectionStart ?? start + insert.length
        selectionRangeRef.current = { start: pos, end: pos }
        setSelectionStart(pos)
        onChange(nextValue)

        requestAnimationFrame(() => {
            textarea.setSelectionRange(pos, pos)
            selectionRangeRef.current = { start: pos, end: pos }
            setSelectionStart(pos)
            syncTransforms()
        })
    }, [disabled, onChange, syncTransforms])

    useEffect(() => {
        if (!insertRequest || handledInsertRequestIdRef.current === insertRequest.id) return
        if (disabled) return

        const textarea = textareaRef.current
        if (!textarea) return

        handledInsertRequestIdRef.current = insertRequest.id

        const fallbackStart = selectionRangeRef.current.start
        const fallbackEnd = selectionRangeRef.current.end
        const start = textarea.selectionStart ?? fallbackStart
        const end = textarea.selectionEnd ?? fallbackEnd
        const nextValue = `${value.slice(0, start)}${insertRequest.text}${value.slice(end)}`
        const nextCaret = start + insertRequest.text.length

        selectionRangeRef.current = { start: nextCaret, end: nextCaret }
        setSelectionStart(nextCaret)
        onChange(nextValue)

        requestAnimationFrame(() => {
            textarea.focus()
            textarea.setSelectionRange(nextCaret, nextCaret)
            selectionRangeRef.current = { start: nextCaret, end: nextCaret }
            setSelectionStart(nextCaret)
            syncTransforms()
        })
    }, [disabled, insertRequest, onChange, syncTransforms, value])

    const matchCountLabel = useMemo(() => {
        if (!findQuery.trim()) return ''
        return t('editor.findCount', {
            current:
                matches.length === 0 || activeMatchIndex < 0
                    ? 0
                    : Math.min(activeMatchIndex + 1, matches.length),
            total: matches.length,
        })
    }, [activeMatchIndex, findQuery, matches.length, t])

    return (
        <div className={cn('flex flex-col overflow-hidden rounded-md border bg-background', className)}>
            <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="shrink-0 min-w-[3.25rem] border-r bg-muted/20 text-muted-foreground font-mono text-xs">
                    <div className="relative px-2 py-2">
                        <div ref={gutterRef} className="will-change-transform">
                            {lines.map((_, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    className={cn(
                                        'block w-full text-right leading-6 tabular-nums px-1 rounded',
                                        idx === activeLine && 'bg-muted/60 text-foreground'
                                    )}
                                    style={{ height: resolvedLineHeights[idx] ?? LINE_HEIGHT_PX }}
                                    onMouseDown={(e) => {
                                        e.preventDefault()
                                        handleLineNumberClick(idx)
                                    }}
                                    disabled={disabled}
                                >
                                    {idx + 1}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div ref={contentRef} className="relative flex-1 min-w-0">
                    <div
                        ref={overlayViewportRef}
                        aria-hidden="true"
                        className="absolute left-0 top-0 h-full overflow-hidden pointer-events-none bg-transparent"
                    >
                        <div
                            ref={overlayRef}
                            className="will-change-transform px-3 py-2 font-mono text-sm leading-6 text-foreground [tab-size:4]"
                        >
                            {lines.map((line, idx) => (
                                <div
                                    key={idx}
                                    ref={(node) => setLineRef(idx, node)}
                                    className={cn(
                                        'w-full whitespace-pre-wrap break-words',
                                        idx === activeLine && 'bg-muted/40'
                                    )}
                                >
                                    {line.length === 0 ? '\u200B' : highlightPromptLine(line)}
                                </div>
                            ))}
                        </div>
                    </div>

                    <textarea
                        ref={textareaRef}
                        value={value}
                        wrap="soft"
                        disabled={disabled}
                        placeholder={placeholder}
                        spellCheck={false}
                        onChange={(e) => onChange(e.target.value)}
                        onScroll={() => syncTransforms()}
                        onSelect={() => syncSelection()}
                        onKeyUp={() => syncSelection()}
                        onMouseUp={() => syncSelection()}
                        onFocus={() => {
                            onEditorFocus?.()
                            syncSelection()
                        }}
                        onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
                                e.preventDefault()
                                focusFind()
                                return
                            }

                            if (e.key === 'Tab') {
                                if (disabled) return
                                e.preventDefault()
                                handleTabIndent()
                                return
                            }
                        }}
                        className={cn(
                            'relative z-10 h-full w-full resize-none overflow-y-auto overflow-x-hidden bg-transparent px-3 py-2',
                            'font-mono text-sm leading-6',
                            '[tab-size:4]',
                            'whitespace-pre-wrap break-words',
                            'caret-foreground text-transparent',
                            'focus-visible:outline-none',
                            'selection:bg-primary/25',
                            'placeholder:text-muted-foreground'
                        )}
                    />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t bg-muted/10 px-2 py-1">
                <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Input
                        ref={findInputRef}
                        value={findQuery}
                        disabled={disabled}
                        onChange={(e) => {
                            setFindQuery(e.target.value)
                            setActiveMatchIndex(-1)
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                if (e.shiftKey) handleFindPrev()
                                else handleFindNext()
                                return
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault()
                                focusEditor()
                            }
                        }}
                        placeholder={t('editor.findPlaceholder')}
                        className="h-8 w-[220px] font-mono text-xs"
                    />
                </div>

                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 gap-1"
                        disabled={disabled || matches.length === 0}
                        onClick={handleFindPrev}
                    >
                        <ChevronUp className="h-4 w-4" />
                        {t('editor.findPrevious')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 gap-1"
                        disabled={disabled || matches.length === 0}
                        onClick={handleFindNext}
                    >
                        <ChevronDown className="h-4 w-4" />
                        {t('editor.findNext')}
                    </Button>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1 select-none">
                        <input
                            type="checkbox"
                            className="accent-primary"
                            checked={findOptions.matchCase}
                            disabled={disabled}
                            onChange={(e) => {
                                setFindOptions((prev) => ({ ...prev, matchCase: e.target.checked }))
                                setActiveMatchIndex(-1)
                            }}
                        />
                        {t('editor.findMatchCase')}
                    </label>
                    <label className="flex items-center gap-1 select-none">
                        <input
                            type="checkbox"
                            className="accent-primary"
                            checked={findOptions.regex}
                            disabled={disabled}
                            onChange={(e) => {
                                setFindOptions((prev) => ({ ...prev, regex: e.target.checked }))
                                setActiveMatchIndex(-1)
                            }}
                        />
                        {t('editor.findRegex')}
                    </label>
                    <label className="flex items-center gap-1 select-none">
                        <input
                            type="checkbox"
                            className="accent-primary"
                            checked={findOptions.wholeWord}
                            disabled={disabled}
                            onChange={(e) => {
                                setFindOptions((prev) => ({ ...prev, wholeWord: e.target.checked }))
                                setActiveMatchIndex(-1)
                            }}
                        />
                        {t('editor.findWholeWord')}
                    </label>
                </div>

                {matchCountLabel && (
                    <div className="ml-auto text-xs text-muted-foreground tabular-nums">{matchCountLabel}</div>
                )}
            </div>
        </div>
    )
}
