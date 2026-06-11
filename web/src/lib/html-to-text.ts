const TEXT_NODE = 3
const ELEMENT_NODE = 1

const DOUBLE_NEWLINE_AFTER_TAGS = new Set([
    'P',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'BLOCKQUOTE',
    'PRE',
])

const SINGLE_NEWLINE_AFTER_TAGS = new Set([
    'LI',
    'TR',
])

const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT'])

export type HtmlToTextOptions = {
    paragraphSeparator?: '\n' | '\n\n'
}

function normalizeText(value: string) {
    return value
        .replace(/\u00A0/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\t+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
}

function applyParagraphSeparator(text: string, paragraphSeparator: '\n' | '\n\n') {
    if (paragraphSeparator === '\n') {
        return text.replace(/\n{2,}/g, '\n')
    }
    return text
}

function decodeHtmlEntities(value: string) {
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
        // Decode &amp; last so entities like &amp;quot; are not double-decoded.
        .replace(/&amp;/g, '&')
}

function stripHtmlWithNewlines(html: string) {
    return decodeHtmlEntities(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|h[1-6]|blockquote|pre)\s*>/gi, '\n\n')
            .replace(/<\/(li|tr)\s*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
    )
}

function nodeToText(node: Node): string {
    if (!node) return ''
    if (node.nodeType === TEXT_NODE) return node.nodeValue ?? ''
    if (node.nodeType !== ELEMENT_NODE) return ''

    const el = node as Element
    const tag = el.tagName

    if (tag === 'BR' || tag === 'HR') return '\n'
    if (IGNORED_TAGS.has(tag)) return ''

    let result = ''
    for (const child of Array.from(el.childNodes)) {
        result += nodeToText(child)
    }

    if (tag === 'TD' || tag === 'TH') {
        result += '\t'
    } else if (DOUBLE_NEWLINE_AFTER_TAGS.has(tag)) {
        result += '\n\n'
    } else if (SINGLE_NEWLINE_AFTER_TAGS.has(tag)) {
        result += '\n'
    }

    return result
}

export function htmlToText(html: string, options: HtmlToTextOptions = {}) {
    if (!html) return ''

    const paragraphSeparator = options.paragraphSeparator ?? '\n\n'

    if (typeof window === 'undefined') {
        const normalized = normalizeText(stripHtmlWithNewlines(html)).trimEnd()
        return applyParagraphSeparator(normalized, paragraphSeparator)
    }

    try {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const normalized = normalizeText(nodeToText(doc.body)).trimEnd()
        return applyParagraphSeparator(normalized, paragraphSeparator)
    } catch {
        const normalized = normalizeText(stripHtmlWithNewlines(html)).trimEnd()
        return applyParagraphSeparator(normalized, paragraphSeparator)
    }
}
