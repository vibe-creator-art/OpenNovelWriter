import { createElement, Fragment, type ReactNode } from 'react'

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

export type RenderSimpleMarkdownOptions = {
    /** Render an inline `[label](llm:<target>)` reference (a Codex model-reply embed). */
    renderLlmRef?: (target: string, label: string, key: string) => ReactNode
    /** Render an inline `[label](model:<groupId>)` mention chip. */
    renderModelRef?: (groupId: string, label: string, key: string) => ReactNode
}

// Set for the duration of a single synchronous renderSimpleMarkdown() call so the
// inline matcher can reach the custom renderers without threading options through
// every helper. Safe because React render is synchronous and single-threaded.
let activeInlineOptions: RenderSimpleMarkdownOptions | null = null

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

function getNextInlineMatch(text: string, startIndex: number): InlineMatch | null {
    const matches = [
        findRegexMatch(text, startIndex, /`([^`\n]+)`/g, 0, (match, key) => createElement('code', { key }, match[1])),
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
        findRegexMatch(text, startIndex, /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, 1, (match, key) =>
            createElement(
                'a',
                { key, href: match[2], target: '_blank', rel: 'noreferrer noopener' },
                ...renderInlineMarkdown(match[1], `${key}-label`)
            )
        ),
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
        findHtmlRegexMatch(text, startIndex, /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, 1, (match) =>
            `<a href="${escapeHtml(match[2])}" target="_blank" rel="noreferrer noopener">${renderInlineMarkdownToHtml(match[1])}</a>`
        ),
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
        { key, className: 'my-3 max-w-full overflow-x-auto' },
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
    try {
        return parseSimpleMarkdown(source, { includeTables: true }).map(renderBlock)
    } finally {
        activeInlineOptions = null
    }
}

export function markdownToHtml(source: string | null | undefined) {
    const blocks = parseSimpleMarkdown(source)
    if (blocks.length === 0) return ''
    return blocks.map(renderBlockToHtml).join('')
}
