import { createElement, Fragment, type ReactNode } from 'react'

import { collapseRepeatedAssistantText } from '@/lib/collapse-repeated-text'

type MarkdownListItem = {
    content: string[]
    children: MarkdownList[]
}

type MarkdownList = {
    ordered: boolean
    items: MarkdownListItem[]
}

type MarkdownTableAlignment = 'left' | 'center' | 'right' | null

type MarkdownTable = {
    headers: string[]
    alignments: MarkdownTableAlignment[]
    rows: string[][]
}

type MarkdownBlock =
    | { type: 'paragraph'; lines: string[] }
    | { type: 'blockquote'; lines: string[] }
    | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: string }
    | { type: 'rule' }
    | { type: 'code'; language: string | null; content: string }
    | { type: 'list'; list: MarkdownList }
    | { type: 'table'; table: MarkdownTable }

type ListMarker = {
    ordered: boolean
    content: string
}

type InlineMatch = {
    index: number
    end: number
    priority: number
    render: (key: string) => ReactNode
}

type HtmlInlineMatch = {
    index: number
    end: number
    priority: number
    render: () => string
}

type ParseSimpleMarkdownOptions = {
    includeTables?: boolean
}

export type WebReference = {
    number: string
    href: string
    title: string
}

export type RenderSimpleMarkdownOptions = {
    renderAnnotationRef?: (index: number, key: string) => ReactNode
    /** Render an inline `[label](llm:<target>)` reference (a Codex model-reply embed). */
    renderLlmRef?: (target: string, label: string, key: string) => ReactNode
    /** Render an inline `[label](model:<groupId>)` mention chip. */
    renderModelRef?: (groupId: string, label: string, key: string) => ReactNode
    /** When false, skip the trailing 参考链接 list so the host can render it once. */
    includeWebReferenceList?: boolean
    /** Reuse references collected from the full message. */
    webReferences?: WebReference[]
}

// Set for the duration of a single synchronous renderSimpleMarkdown() call so the
// inline matcher can reach the custom renderers without threading options through
// every helper. Safe because React render is synchronous and single-threaded.
let activeInlineOptions: RenderSimpleMarkdownOptions | null = null
let activeWebReferences: WebReference[] = []
let activeWebReferenceByHref = new Map<string, WebReference>()
let activeWebReferenceByNumber = new Map<string, WebReference>()

function getIndentWidth(line: string) {
    let width = 0
    for (const char of line) {
        if (char === ' ') {
            width += 1
            continue
        }
        if (char === '\t') {
            width += 4
            continue
        }
        break
    }
    return width
}

function matchListMarker(line: string): ListMarker | null {
    const trimmedStart = line.trimStart()
    const unorderedMatch = trimmedStart.match(/^[-*+]\s+(.+)$/)
    if (unorderedMatch) {
        return {
            ordered: false,
            content: unorderedMatch[1],
        }
    }

    const orderedMatch = trimmedStart.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) {
        return {
            ordered: true,
            content: orderedMatch[1],
        }
    }

    return null
}

function parseList(lines: string[], startIndex: number, indent: number, ordered: boolean): { list: MarkdownList; nextIndex: number } {
    const items: MarkdownListItem[] = []
    let index = startIndex

    while (index < lines.length) {
        const line = lines[index]
        if (!line.trim()) break

        const currentIndent = getIndentWidth(line)
        const marker = matchListMarker(line)
        if (!marker || currentIndent < indent || currentIndent > indent || marker.ordered !== ordered) break

        const item: MarkdownListItem = {
            content: [marker.content],
            children: [],
        }
        index += 1

        while (index < lines.length) {
            const nextLine = lines[index]
            if (!nextLine.trim()) break

            const nextIndent = getIndentWidth(nextLine)
            const nextMarker = matchListMarker(nextLine)

            if (nextMarker && nextIndent > indent) {
                const nested = parseList(lines, index, nextIndent, nextMarker.ordered)
                item.children.push(nested.list)
                index = nested.nextIndex
                continue
            }

            if (nextIndent > indent && !nextMarker) {
                item.content.push(nextLine.trim())
                index += 1
                continue
            }

            break
        }

        items.push(item)
    }

    return {
        list: { ordered, items },
        nextIndex: index,
    }
}

function splitTableCells(line: string) {
    const trimmed = line.trim()
    const withoutLeadingPipe = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
    const normalized = withoutLeadingPipe.endsWith('|') ? withoutLeadingPipe.slice(0, -1) : withoutLeadingPipe
    const cells: string[] = []
    let current = ''

    for (let i = 0; i < normalized.length; i += 1) {
        const char = normalized[i]
        const previous = i > 0 ? normalized[i - 1] : ''
        if (char === '|' && previous !== '\\') {
            cells.push(current.trim().replaceAll('\\|', '|'))
            current = ''
            continue
        }
        current += char
    }

    cells.push(current.trim().replaceAll('\\|', '|'))
    return cells
}

function parseTableSeparator(line: string): MarkdownTableAlignment[] | null {
    if (!line.includes('|')) return null

    const cells = splitTableCells(line)
    if (cells.length < 2) return null

    const alignments: MarkdownTableAlignment[] = []
    for (const cell of cells) {
        const normalized = cell.replace(/\s+/g, '')
        if (!/^:?-{3,}:?$/.test(normalized)) return null
        const startsWithColon = normalized.startsWith(':')
        const endsWithColon = normalized.endsWith(':')
        if (startsWithColon && endsWithColon) {
            alignments.push('center')
        } else if (endsWithColon) {
            alignments.push('right')
        } else if (startsWithColon) {
            alignments.push('left')
        } else {
            alignments.push(null)
        }
    }

    return alignments
}

function normalizeTableCells(cells: string[], columnCount: number) {
    if (cells.length === columnCount) return cells
    if (cells.length > columnCount) return cells.slice(0, columnCount)
    return [...cells, ...Array.from({ length: columnCount - cells.length }, () => '')]
}

function parseTable(lines: string[], startIndex: number): { table: MarkdownTable; nextIndex: number } | null {
    const headerLine = lines[startIndex]
    const separatorLine = lines[startIndex + 1]
    if (!headerLine || !separatorLine) return null
    if (!headerLine.includes('|')) return null

    const headers = splitTableCells(headerLine)
    const alignments = parseTableSeparator(separatorLine)
    if (!alignments) return null
    if (headers.length < 2 || headers.length !== alignments.length) return null

    const rows: string[][] = []
    let index = startIndex + 2

    while (index < lines.length) {
        const line = lines[index]
        if (!line.trim() || !line.includes('|')) break

        const cells = splitTableCells(line)
        if (cells.length < 2) break
        rows.push(normalizeTableCells(cells, headers.length))
        index += 1
    }

    return {
        table: {
            headers,
            alignments,
            rows,
        },
        nextIndex: index,
    }
}

function isTableStart(lines: string[], index: number) {
    return Boolean(lines[index]?.includes('|') && lines[index + 1] && parseTableSeparator(lines[index + 1]) !== null)
}

function parseSimpleMarkdown(source: string | null | undefined, options: ParseSimpleMarkdownOptions = {}): MarkdownBlock[] {
    const normalized = typeof source === 'string' ? source.replace(/\r\n?/g, '\n').trim() : ''
    if (!normalized) return []

    const lines = normalized.split('\n')
    const blocks: MarkdownBlock[] = []
    const includeTables = options.includeTables ?? false

    let index = 0
    while (index < lines.length) {
        const currentLine = lines[index]
        const trimmed = currentLine.trim()

        if (!trimmed) {
            index += 1
            continue
        }

        const fencedCodeMatch = trimmed.match(/^```([\w-]+)?\s*$/)
        if (fencedCodeMatch) {
            const codeLines: string[] = []
            const language = fencedCodeMatch[1]?.trim() || null
            index += 1

            while (index < lines.length && !lines[index].trim().match(/^```\s*$/)) {
                codeLines.push(lines[index])
                index += 1
            }

            if (index < lines.length) index += 1

            blocks.push({ type: 'code', language, content: codeLines.join('\n') })
            continue
        }

        if (includeTables) {
            const parsedTable = parseTable(lines, index)
            if (parsedTable) {
                blocks.push({ type: 'table', table: parsedTable.table })
                index = parsedTable.nextIndex
                continue
            }
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
        if (headingMatch) {
            const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6
            blocks.push({
                type: 'heading',
                level,
                content: headingMatch[2],
            })
            index += 1
            continue
        }

        if (/^(\*\s*\*\s*\*|-{3,}|_{3,})$/.test(trimmed)) {
            blocks.push({ type: 'rule' })
            index += 1
            continue
        }

        if (/^>\s?/.test(trimmed)) {
            const quoteLines: string[] = []
            while (index < lines.length) {
                const quoteLine = lines[index].trim()
                if (!quoteLine.startsWith('>')) break
                quoteLines.push(quoteLine.replace(/^>\s?/, ''))
                index += 1
            }
            blocks.push({ type: 'blockquote', lines: quoteLines })
            continue
        }

        const listMarker = matchListMarker(currentLine)
        const currentIndent = getIndentWidth(currentLine)

        if (listMarker && !listMarker.ordered) {
            const parsed = parseList(lines, index, currentIndent, false)
            blocks.push({ type: 'list', list: parsed.list })
            index = parsed.nextIndex
            continue
        }

        if (listMarker && listMarker.ordered) {
            const parsed = parseList(lines, index, currentIndent, true)
            blocks.push({ type: 'list', list: parsed.list })
            index = parsed.nextIndex
            continue
        }

        const paragraphLines: string[] = []
        while (index < lines.length) {
            const paragraphLine = lines[index]
            const paragraphTrimmed = paragraphLine.trim()

            if (!paragraphTrimmed) break
            if (
                paragraphTrimmed.match(/^```([\w-]+)?\s*$/) ||
                paragraphTrimmed.match(/^(#{1,6})\s+/) ||
                paragraphTrimmed.match(/^(\*\s*\*\s*\*|-{3,}|_{3,})$/) ||
                paragraphTrimmed.startsWith('>') ||
                paragraphTrimmed.match(/^[-*+]\s+/) ||
                paragraphTrimmed.match(/^\d+\.\s+/) ||
                (includeTables && isTableStart(lines, index))
            ) {
                break
            }

            paragraphLines.push(paragraphLine)
            index += 1
        }

        if (paragraphLines.length > 0) {
            blocks.push({ type: 'paragraph', lines: paragraphLines })
            continue
        }

        index += 1
    }

    return blocks
}

function findRegexMatch(
    text: string,
    startIndex: number,
    regex: RegExp,
    priority: number,
    renderMatch: (match: RegExpExecArray, key: string) => ReactNode
): InlineMatch | null {
    regex.lastIndex = startIndex
    const match = regex.exec(text)
    if (!match) return null

    return {
        index: match.index,
        end: match.index + match[0].length,
        priority,
        render: (key) => renderMatch(match, key),
    }
}

// Images accept absolute http(s) URLs and app-relative paths like /uploads/….
const INLINE_IMAGE_RE = /!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g
const WEB_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
const WEB_CITATION_RE = /\[\[([^\]]+)\]\]\((https?:\/\/[^\s)]+)\)/g
const ANGLE_URL_RE = /<((?:https?:\/\/)[^>\s]+)>/g
const BARE_URL_RE = /https?:\/\/[^\s<>"'`\[\]（）)]+/g
const WEB_LINK_CLASS = 'text-primary underline underline-offset-2'
const WEB_CITE_CLASS = 'text-primary no-underline hover:underline'
const BARE_CITATION_RE = /\[(\d{1,2})\](?!\()/g

function isCitationNumber(value: string) {
    return /^\d{1,2}$/.test(value.trim())
}

function isHttpUrl(value: string) {
    return /^https?:\/\/\S+$/i.test(value.trim())
}

function shortenUrlLabel(url: string) {
    try {
        const parsed = new URL(url)
        const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')
        const shown = `${parsed.host}${path}`
        return shown.length > 42 ? `${shown.slice(0, 39)}…` : shown
    } catch {
        return url.length > 42 ? `${url.slice(0, 39)}…` : url
    }
}

function webLinkLabel(label: string, href: string) {
    const trimmed = label.trim()
    if (!trimmed || isHttpUrl(trimmed) || trimmed === href) return shortenUrlLabel(href)
    return trimmed
}

function webLinkProps(href: string) {
    return {
        href,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: href,
    } as const
}

function trimBareUrl(raw: string) {
    return raw.replace(/[.,;:!?。，、]+$/u, '')
}

function stripMarkdownCode(source: string) {
    return source.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]+`/g, ' ')
}

function resetSharedRegexes() {
    WEB_CITATION_RE.lastIndex = 0
    WEB_LINK_RE.lastIndex = 0
    ANGLE_URL_RE.lastIndex = 0
    BARE_URL_RE.lastIndex = 0
    BARE_CITATION_RE.lastIndex = 0
}

function normalizeWebHref(href: string) {
    return href.replace(/[)#]+$/g, '').replace(/\/+$/, '')
}

function addWebReference(href: string, title: string, number?: string) {
    const normalizedHref = normalizeWebHref(href)
    const existing = activeWebReferenceByHref.get(normalizedHref) ?? activeWebReferenceByHref.get(href)
    if (existing) {
        if (number && existing.number !== number) {
            if (existing.number) activeWebReferenceByNumber.delete(existing.number)
            if (!activeWebReferenceByNumber.has(number)) {
                existing.number = number
                activeWebReferenceByNumber.set(number, existing)
            }
        }
        if (
            title
            && !isCitationNumber(title)
            && !isHttpUrl(title)
            && (isCitationNumber(existing.title) || isHttpUrl(existing.title) || existing.title === shortenUrlLabel(existing.href))
        ) {
            existing.title = title
        }
        return existing
    }

    const ref: WebReference = {
        number: number && !activeWebReferenceByNumber.has(number) ? number : '',
        href: normalizedHref || href,
        title: webLinkLabel(title || shortenUrlLabel(href), href),
    }
    activeWebReferenceByHref.set(ref.href, ref)
    if (ref.number) activeWebReferenceByNumber.set(ref.number, ref)
    return ref
}

export function collectWebReferences(source: string | null | undefined): WebReference[] {
    activeWebReferences = []
    activeWebReferenceByHref = new Map()
    activeWebReferenceByNumber = new Map()
    const collapsed = collapseRepeatedAssistantText(typeof source === 'string' ? source : '')
    const stripped = stripMarkdownCode(collapsed)
    if (!stripped.trim()) return []

    resetSharedRegexes()
    for (const match of stripped.matchAll(WEB_CITATION_RE)) {
        addWebReference(match[2], match[1], isCitationNumber(match[1]) ? match[1] : undefined)
    }
    resetSharedRegexes()
    for (const match of stripped.matchAll(WEB_LINK_RE)) {
        addWebReference(match[2], match[1], isCitationNumber(match[1]) ? match[1] : undefined)
    }
    resetSharedRegexes()
    for (const match of stripped.matchAll(ANGLE_URL_RE)) {
        addWebReference(match[1], shortenUrlLabel(match[1]))
    }
    resetSharedRegexes()
    for (const match of stripped.matchAll(BARE_URL_RE)) {
        const url = trimBareUrl(match[0])
        if (url) addWebReference(url, shortenUrlLabel(url))
    }

    let next = 1
    for (const ref of activeWebReferenceByHref.values()) {
        if (ref.number && activeWebReferenceByNumber.get(ref.number) === ref) continue
        if (ref.number && activeWebReferenceByNumber.get(ref.number) !== ref) {
            ref.number = ''
        }
        while (activeWebReferenceByNumber.has(String(next))) next += 1
        ref.number = String(next)
        activeWebReferenceByNumber.set(ref.number, ref)
        next += 1
    }

    const seenHref = new Set<string>()
    const seenNumber = new Set<string>()
    activeWebReferences = [...activeWebReferenceByHref.values()]
        .sort((left, right) => Number(left.number) - Number(right.number))
        .filter((ref) => {
            if (!ref.number || seenHref.has(ref.href) || seenNumber.has(ref.number)) return false
            seenHref.add(ref.href)
            seenNumber.add(ref.number)
            return true
        })
    return activeWebReferences
}

function lookupWebReference(href?: string, number?: string) {
    if (href && activeWebReferenceByHref.has(href)) return activeWebReferenceByHref.get(href)
    if (number && activeWebReferenceByNumber.has(number)) return activeWebReferenceByNumber.get(number)
    return undefined
}

function activateWebReferences(refs: WebReference[]) {
    activeWebReferences = refs
    activeWebReferenceByHref = new Map(refs.map((ref) => [ref.href, ref]))
    activeWebReferenceByNumber = new Map(refs.map((ref) => [ref.number, ref]))
}

function renderCitationMark(key: string, number: string, href?: string): ReactNode {
    const isExternal = Boolean(href && isHttpUrl(href))
    return createElement(
        'sup',
        { key, className: 'ml-0.5 text-[0.7em] font-medium leading-none' },
        createElement(
            'a',
            {
                ...(isExternal && href ? webLinkProps(href) : {}),
                href: isExternal && href ? href : `#onw-ref-${number}`,
                className: WEB_CITE_CLASS,
                'data-onw-ref': number,
            },
            `[${number}]`
        )
    )
}

function uniqueWebReferences(refs: WebReference[]) {
    const seenHref = new Set<string>()
    const seenNumber = new Set<string>()
    return refs.filter((ref) => {
        if (!ref.number || seenHref.has(ref.href) || seenNumber.has(ref.number)) return false
        seenHref.add(ref.href)
        seenNumber.add(ref.number)
        return true
    })
}

export function renderWebReferenceList(refs: WebReference[], key = 'onw-web-refs'): ReactNode | null {
    refs = uniqueWebReferences(refs)
    if (refs.length === 0) return null
    return createElement(
        'div',
        { key, className: 'mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground not-prose' },
        createElement('div', { className: 'mb-1.5 font-medium text-foreground/80' }, '参考链接'),
        createElement(
            'ol',
            { className: 'my-0 list-none space-y-1 pl-0' },
            ...refs.map((ref, index) =>
                createElement(
                    'li',
                    { key: `${key}-${ref.number}-${index}`, id: `onw-ref-${ref.number}`, className: 'flex gap-1.5 break-words [overflow-wrap:anywhere]' },
                    createElement('span', { className: 'shrink-0 text-muted-foreground' }, `[${ref.number}]`),
                    createElement(
                        'a',
                        { ...webLinkProps(ref.href), className: `${WEB_LINK_CLASS} min-w-0` },
                        ref.title
                    )
                )
            )
        )
    )
}

function renderWebReferenceListHtml(refs: WebReference[]) {
    refs = uniqueWebReferences(refs)
    if (refs.length === 0) return ''
    const items = refs
        .map((ref) =>
            `<li id="onw-ref-${escapeHtml(ref.number)}">[${escapeHtml(ref.number)}] <a href="${escapeHtml(ref.href)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(ref.href)}">${escapeHtml(ref.title)}</a></li>`
        )
        .join('')
    return `<section><h6>参考链接</h6><ol>${items}</ol></section>`
}

function findBareUrlMatch(
    text: string,
    startIndex: number,
    priority: number,
    renderMatch: (url: string, key: string) => ReactNode
): InlineMatch | null {
    BARE_URL_RE.lastIndex = startIndex
    const match = BARE_URL_RE.exec(text)
    if (!match) return null
    const url = trimBareUrl(match[0])
    if (!url) return null
    return {
        index: match.index,
        end: match.index + url.length,
        priority,
        render: (key) => renderMatch(url, key),
    }
}

function findBareUrlHtmlMatch(
    text: string,
    startIndex: number,
    priority: number,
    renderMatch: (url: string) => string
): HtmlInlineMatch | null {
    BARE_URL_RE.lastIndex = startIndex
    const match = BARE_URL_RE.exec(text)
    if (!match) return null
    const url = trimBareUrl(match[0])
    if (!url) return null
    return {
        index: match.index,
        end: match.index + url.length,
        priority,
        render: () => renderMatch(url),
    }
}

function getNextInlineMatch(text: string, startIndex: number): InlineMatch | null {
    const matches = [
        findRegexMatch(text, startIndex, /`([^`\n]+)`/g, 0, (match, key) => createElement('code', { key }, match[1])),
        activeInlineOptions?.renderAnnotationRef
            ? findRegexMatch(text, startIndex, /:codex-annotation\{index="([1-9]\d*)"\}/g, 1, (match, key) =>
                activeInlineOptions!.renderAnnotationRef!(Number(match[1]), key))
            : null,
        findRegexMatch(text, startIndex, new RegExp(INLINE_IMAGE_RE), 1, (match, key) =>
            createElement('img', {
                key,
                src: match[2],
                alt: match[1],
                loading: 'lazy',
                // Clicking opens the shared image viewer via ImageViewerBoundary.
                'data-onw-image': match[2],
                className: 'my-1 max-h-64 w-auto max-w-full cursor-zoom-in rounded-lg border',
            })
        ),
        findRegexMatch(text, startIndex, WEB_CITATION_RE, 1, (match, key) => {
            const ref = lookupWebReference(match[2], isCitationNumber(match[1]) ? match[1] : undefined)
            return renderCitationMark(key, ref?.number || match[1], ref?.href || match[2])
        }),
        findRegexMatch(text, startIndex, WEB_LINK_RE, 1, (match, key) => {
            const href = match[2]
            const ref = lookupWebReference(href, isCitationNumber(match[1]) ? match[1] : undefined)
            if (isCitationNumber(match[1]) || isHttpUrl(match[1])) {
                return renderCitationMark(key, ref?.number || match[1], ref?.href || href)
            }
            return createElement(
                Fragment,
                { key },
                ...renderInlineMarkdown(match[1], `${key}-label`),
                renderCitationMark(`${key}-cite`, ref?.number || '1', ref?.href || href)
            )
        }),
        findRegexMatch(text, startIndex, /\[([^\]]+)\]\((chapter|act|scene):([^\s)]+)\)/g, 1, (match, key) =>
            createElement(
                'a',
                {
                    key,
                    role: 'button',
                    tabIndex: 0,
                    className: 'cursor-pointer text-primary underline underline-offset-2',
                    'data-onw-nav': match[2],
                    'data-onw-nav-id': match[3],
                },
                ...renderInlineMarkdown(match[1], `${key}-label`)
            )
        ),
        findRegexMatch(text, startIndex, /\[([^\]]+)\]\(llm:([^\s)]+)\)/g, 1, (match, key) => {
            if (activeInlineOptions?.renderLlmRef) {
                return activeInlineOptions.renderLlmRef(match[2], match[1], key)
            }
            return createElement('span', { key, className: 'text-muted-foreground' }, match[1])
        }),
        findRegexMatch(text, startIndex, /\[([^\]]+)\]\(model:([^\s)]+)\)/g, 1, (match, key) => {
            if (activeInlineOptions?.renderModelRef) {
                return activeInlineOptions.renderModelRef(match[2], match[1], key)
            }
            return createElement(
                'span',
                {
                    key,
                    className:
                        'inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] font-medium text-foreground',
                },
                `@${match[1]}`
            )
        }),
        findRegexMatch(text, startIndex, /\*\*(.+?)\*\*/g, 2, (match, key) =>
            createElement('strong', { key }, ...renderInlineMarkdown(match[1], key))
        ),
        findRegexMatch(text, startIndex, /__(.+?)__/g, 3, (match, key) =>
            createElement('strong', { key }, ...renderInlineMarkdown(match[1], key))
        ),
        findRegexMatch(text, startIndex, /~~(.+?)~~/g, 4, (match, key) =>
            createElement('del', { key }, ...renderInlineMarkdown(match[1], key))
        ),
        findRegexMatch(text, startIndex, /\*(.+?)\*/g, 5, (match, key) =>
            createElement('em', { key }, ...renderInlineMarkdown(match[1], key))
        ),
        findRegexMatch(text, startIndex, /_(.+?)_/g, 6, (match, key) =>
            createElement('em', { key }, ...renderInlineMarkdown(match[1], key))
        ),
        findRegexMatch(text, startIndex, BARE_CITATION_RE, 7, (match, key) => {
            const ref = lookupWebReference(undefined, match[1])
            return renderCitationMark(key, ref?.number || match[1], ref?.href)
        }),
        findRegexMatch(text, startIndex, ANGLE_URL_RE, 8, (match, key) => {
            const ref = lookupWebReference(match[1])
            return renderCitationMark(key, ref?.number || '1', ref?.href || match[1])
        }),
        findBareUrlMatch(text, startIndex, 9, (url, key) => {
            const ref = lookupWebReference(url)
            return renderCitationMark(key, ref?.number || '1', ref?.href || url)
        }),
    ].filter((match): match is InlineMatch => match !== null)

    return (
        matches.sort((left, right) => left.index - right.index || left.priority - right.priority)[0] ??
        null
    )
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
    const nodes: ReactNode[] = []
    let index = 0
    let textKey = 0
    let nodeKey = 0

    while (index < text.length) {
        const match = getNextInlineMatch(text, index)

        if (!match) {
            nodes.push(createElement(Fragment, { key: `${keyPrefix}-text-${textKey}` }, text.slice(index)))
            break
        }

        if (match.index > index) {
            nodes.push(createElement(Fragment, { key: `${keyPrefix}-text-${textKey}` }, text.slice(index, match.index)))
            textKey += 1
        }

        nodes.push(match.render(`${keyPrefix}-node-${nodeKey}`))
        nodeKey += 1
        index = match.end
    }

    return nodes
}

function escapeHtml(text: string) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

function findHtmlRegexMatch(
    text: string,
    startIndex: number,
    regex: RegExp,
    priority: number,
    renderMatch: (match: RegExpExecArray) => string
): HtmlInlineMatch | null {
    regex.lastIndex = startIndex
    const match = regex.exec(text)
    if (!match) return null

    return {
        index: match.index,
        end: match.index + match[0].length,
        priority,
        render: () => renderMatch(match),
    }
}

function getNextInlineHtmlMatch(text: string, startIndex: number): HtmlInlineMatch | null {
    const matches = [
        findHtmlRegexMatch(text, startIndex, /`([^`\n]+)`/g, 0, (match) => `<code>${escapeHtml(match[1])}</code>`),
        findHtmlRegexMatch(text, startIndex, new RegExp(INLINE_IMAGE_RE), 1, (match) =>
            `<img src="${escapeHtml(match[2])}" alt="${escapeHtml(match[1])}">`
        ),
        findHtmlRegexMatch(text, startIndex, WEB_CITATION_RE, 1, (match) => {
            const ref = lookupWebReference(match[2], isCitationNumber(match[1]) ? match[1] : undefined)
            const number = ref?.number || match[1]
            const href = ref?.href || match[2]
            return `<sup><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(href)}">[${escapeHtml(number)}]</a></sup>`
        }),
        findHtmlRegexMatch(text, startIndex, WEB_LINK_RE, 1, (match) => {
            const href = match[2]
            const ref = lookupWebReference(href, isCitationNumber(match[1]) ? match[1] : undefined)
            const number = ref?.number || (isCitationNumber(match[1]) ? match[1] : '1')
            const mark = `<sup><a href="${escapeHtml(ref?.href || href)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(ref?.href || href)}">[${escapeHtml(number)}]</a></sup>`
            if (isCitationNumber(match[1]) || isHttpUrl(match[1])) return mark
            return `${renderInlineMarkdownToHtml(match[1])}${mark}`
        }),
        findHtmlRegexMatch(text, startIndex, /\[([^\]]+)\]\((chapter|act|scene):([^\s)]+)\)/g, 1, (match) =>
            `<span class="text-primary">${renderInlineMarkdownToHtml(match[1])}</span>`
        ),
        findHtmlRegexMatch(text, startIndex, /\[([^\]]+)\]\(llm:([^\s)]+)\)/g, 1, (match) =>
            `<span>${renderInlineMarkdownToHtml(match[1])}</span>`
        ),
        findHtmlRegexMatch(text, startIndex, /\[([^\]]+)\]\(model:([^\s)]+)\)/g, 1, (match) =>
            `<span>@${renderInlineMarkdownToHtml(match[1])}</span>`
        ),
        findHtmlRegexMatch(text, startIndex, /\*\*(.+?)\*\*/g, 2, (match) =>
            `<strong>${renderInlineMarkdownToHtml(match[1])}</strong>`
        ),
        findHtmlRegexMatch(text, startIndex, /__(.+?)__/g, 3, (match) =>
            `<strong>${renderInlineMarkdownToHtml(match[1])}</strong>`
        ),
        findHtmlRegexMatch(text, startIndex, /~~(.+?)~~/g, 4, (match) =>
            `<del>${renderInlineMarkdownToHtml(match[1])}</del>`
        ),
        findHtmlRegexMatch(text, startIndex, /\*(.+?)\*/g, 5, (match) =>
            `<em>${renderInlineMarkdownToHtml(match[1])}</em>`
        ),
        findHtmlRegexMatch(text, startIndex, /_(.+?)_/g, 6, (match) =>
            `<em>${renderInlineMarkdownToHtml(match[1])}</em>`
        ),
        findHtmlRegexMatch(text, startIndex, BARE_CITATION_RE, 7, (match) => {
            const ref = lookupWebReference(undefined, match[1])
            const href = ref?.href || `#onw-ref-${match[1]}`
            return `<sup><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">[${escapeHtml(ref?.number || match[1])}]</a></sup>`
        }),
        findHtmlRegexMatch(text, startIndex, ANGLE_URL_RE, 8, (match) => {
            const ref = lookupWebReference(match[1])
            const href = ref?.href || match[1]
            return `<sup><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(href)}">[${escapeHtml(ref?.number || '1')}]</a></sup>`
        }),
        findBareUrlHtmlMatch(text, startIndex, 9, (url) => {
            const ref = lookupWebReference(url)
            const href = ref?.href || url
            return `<sup><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(href)}">[${escapeHtml(ref?.number || '1')}]</a></sup>`
        }),
    ].filter((match): match is HtmlInlineMatch => match !== null)

    return (
        matches.sort((left, right) => left.index - right.index || left.priority - right.priority)[0] ??
        null
    )
}

function renderInlineMarkdownToHtml(text: string): string {
    const parts: string[] = []
    let index = 0

    while (index < text.length) {
        const match = getNextInlineHtmlMatch(text, index)

        if (!match) {
            parts.push(escapeHtml(text.slice(index)))
            break
        }

        if (match.index > index) {
            parts.push(escapeHtml(text.slice(index, match.index)))
        }

        parts.push(match.render())
        index = match.end
    }

    return parts.join('')
}

function renderLinesToHtml(lines: string[]): string {
    return lines.map((line) => renderInlineMarkdownToHtml(line)).join('<br>')
}

function renderListToHtml(list: MarkdownList): string {
    const tag = list.ordered ? 'ol' : 'ul'
    const items = list.items
        .map((item) => {
            const children = item.children.map(renderListToHtml).join('')
            return `<li>${renderLinesToHtml(item.content)}${children}</li>`
        })
        .join('')
    return `<${tag}>${items}</${tag}>`
}

function getTextAlignStyle(alignment: MarkdownTableAlignment) {
    return alignment ? { textAlign: alignment } : undefined
}

function renderTableToHtml(table: MarkdownTable): string {
    const header = table.headers
        .map((cell, index) => {
            const alignment = table.alignments[index]
            const style = alignment ? ` style="text-align:${alignment}"` : ''
            return `<th${style}>${renderInlineMarkdownToHtml(cell)}</th>`
        })
        .join('')
    const rows = table.rows
        .map((row) => {
            const cells = row
                .map((cell, index) => {
                    const alignment = table.alignments[index]
                    const style = alignment ? ` style="text-align:${alignment}"` : ''
                    return `<td${style}>${renderInlineMarkdownToHtml(cell)}</td>`
                })
                .join('')
            return `<tr>${cells}</tr>`
        })
        .join('')
    return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
}

function renderBlockToHtml(block: MarkdownBlock): string {
    if (block.type === 'paragraph') {
        return `<p>${renderLinesToHtml(block.lines)}</p>`
    }

    if (block.type === 'blockquote') {
        return `<blockquote>${renderLinesToHtml(block.lines)}</blockquote>`
    }

    if (block.type === 'heading') {
        return `<h${block.level}>${renderInlineMarkdownToHtml(block.content)}</h${block.level}>`
    }

    if (block.type === 'rule') {
        return '<hr>'
    }

    if (block.type === 'code') {
        const className = block.language ? ` class="language-${escapeHtml(block.language)}"` : ''
        return `<pre><code${className}>${escapeHtml(block.content)}</code></pre>`
    }

    if (block.type === 'table') {
        return renderTableToHtml(block.table)
    }

    return renderListToHtml(block.list)
}

function renderLines(lines: string[], keyPrefix: string): ReactNode[] {
    return lines.flatMap((line, index) => [
        ...(index > 0 ? [createElement('br', { key: `${keyPrefix}-br-${index}` })] : []),
        ...renderInlineMarkdown(line, `${keyPrefix}-line-${index}`),
    ])
}

function renderList(list: MarkdownList, key: string): ReactNode {
    const tag = list.ordered ? 'ol' : 'ul'

    return createElement(
        tag,
        { key },
        ...list.items.map((item, index) =>
            createElement(
                'li',
                { key: `${key}-item-${index}` },
                ...renderLines(item.content, `${key}-item-${index}-content`),
                ...item.children.map((child, childIndex) => renderList(child, `${key}-item-${index}-child-${childIndex}`))
            )
        )
    )
}

function renderTable(table: MarkdownTable, key: string): ReactNode {
    return createElement(
        'div',
        { key, className: 'onw-table-scroll my-3 max-w-full overflow-x-auto' },
        createElement(
            'table',
            { className: 'w-full min-w-max border-collapse text-sm' },
            createElement(
                'thead',
                null,
                createElement(
                    'tr',
                    null,
                    ...table.headers.map((cell, index) =>
                        createElement(
                            'th',
                            {
                                key: `${key}-head-${index}`,
                                className: 'border bg-muted/50 px-3 py-2 text-left font-semibold align-top',
                                style: getTextAlignStyle(table.alignments[index]),
                            },
                            ...renderInlineMarkdown(cell, `${key}-head-${index}`)
                        )
                    )
                )
            ),
            createElement(
                'tbody',
                null,
                ...table.rows.map((row, rowIndex) =>
                    createElement(
                        'tr',
                        { key: `${key}-row-${rowIndex}` },
                        ...row.map((cell, cellIndex) =>
                            createElement(
                                'td',
                                {
                                    key: `${key}-row-${rowIndex}-cell-${cellIndex}`,
                                    className: 'border px-3 py-2 align-top',
                                    style: getTextAlignStyle(table.alignments[cellIndex]),
                                },
                                ...renderInlineMarkdown(cell, `${key}-row-${rowIndex}-cell-${cellIndex}`)
                            )
                        )
                    )
                )
            )
        )
    )
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
    const key = `markdown-block-${index}`

    if (block.type === 'paragraph') {
        return createElement('p', { key }, ...renderLines(block.lines, key))
    }

    if (block.type === 'blockquote') {
        return createElement('blockquote', { key }, ...renderLines(block.lines, key))
    }

    if (block.type === 'heading') {
        return createElement(`h${block.level}`, { key }, ...renderInlineMarkdown(block.content, key))
    }

    if (block.type === 'rule') {
        return createElement('hr', { key })
    }

    if (block.type === 'code') {
        return createElement(
            'pre',
            { key },
            createElement('code', block.language ? { className: `language-${block.language}` } : null, block.content)
        )
    }

    if (block.type === 'table') {
        return renderTable(block.table, key)
    }

    return renderList(block.list, key)
}

export function renderSimpleMarkdown(source: string | null | undefined, options?: RenderSimpleMarkdownOptions) {
    activeInlineOptions = options ?? null
    const collapsed = collapseRepeatedAssistantText(typeof source === 'string' ? source : '')
    const refs = options?.webReferences ?? collectWebReferences(collapsed)
    if (options?.webReferences) activateWebReferences(options.webReferences)
    try {
        const nodes = parseSimpleMarkdown(collapsed, { includeTables: true }).map(renderBlock)
        if (options?.includeWebReferenceList === false) return nodes
        const list = renderWebReferenceList(refs)
        return list ? [...nodes, list] : nodes
    } finally {
        activeInlineOptions = null
    }
}

export function markdownToHtml(source: string | null | undefined) {
    const collapsed = collapseRepeatedAssistantText(typeof source === 'string' ? source : '')
    const refs = collectWebReferences(collapsed)
    const blocks = parseSimpleMarkdown(collapsed)
    if (blocks.length === 0 && refs.length === 0) return ''
    return `${blocks.map(renderBlockToHtml).join('')}${renderWebReferenceListHtml(refs)}`
}
