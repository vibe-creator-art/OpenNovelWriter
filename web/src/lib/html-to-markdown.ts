import { htmlToText } from '@/lib/html-to-text'

const TEXT_NODE = 3
const ELEMENT_NODE = 1

const BLOCK_TAGS = new Set([
    'ADDRESS',
    'ARTICLE',
    'ASIDE',
    'BLOCKQUOTE',
    'DIV',
    'DL',
    'FIELDSET',
    'FIGCAPTION',
    'FIGURE',
    'FOOTER',
    'FORM',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'HEADER',
    'HR',
    'LI',
    'MAIN',
    'NAV',
    'OL',
    'P',
    'PRE',
    'SECTION',
    'TABLE',
    'UL',
])

const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT'])

function normalizeText(value: string) {
    return value.replace(/\u00A0/g, ' ').replace(/\r\n?/g, '\n')
}

function normalizeInlineMarkdown(value: string) {
    return normalizeText(value)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function normalizeMarkdown(value: string) {
    return value
        .replace(/\u00A0/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function getCodeLanguage(element: Element) {
    const classNames = `${element.getAttribute('class') ?? ''} ${element.firstElementChild?.getAttribute('class') ?? ''}`
    const match = classNames.match(/(?:^|\s)(?:language-|lang-)([\w-]+)(?:\s|$)/i)
    return match?.[1]?.trim() ?? ''
}

function wrapInlineMarkdown(markdown: string, marker: string) {
    const normalized = normalizeInlineMarkdown(markdown)
    if (!normalized) return ''
    return `${marker}${normalized}${marker}`
}

function renderInlineNodes(nodes: Node[]): string {
    return nodes.map((node) => renderInlineNode(node)).join('')
}

function renderBlocks(nodes: Node[]): string[] {
    const blocks: string[] = []
    let inlineBuffer = ''

    const flushInlineBuffer = () => {
        const normalized = normalizeInlineMarkdown(inlineBuffer)
        if (normalized) blocks.push(normalized)
        inlineBuffer = ''
    }

    for (const node of nodes) {
        if (node.nodeType === TEXT_NODE) {
            inlineBuffer += normalizeText(node.nodeValue ?? '')
            continue
        }

        if (node.nodeType !== ELEMENT_NODE) continue

        const element = node as Element
        const tag = element.tagName
        if (IGNORED_TAGS.has(tag)) continue

        if (tag === 'BR') {
            inlineBuffer += '\n'
            continue
        }

        if (!BLOCK_TAGS.has(tag)) {
            inlineBuffer += renderInlineNode(node)
            continue
        }

        flushInlineBuffer()
        const block = renderBlockElement(element)
        if (block) blocks.push(block)
    }

    flushInlineBuffer()
    return blocks
}

function renderBlockElement(element: Element): string {
    const tag = element.tagName

    if (tag === 'HR') return '---'

    if (tag === 'PRE') {
        const text = normalizeText(element.textContent ?? '').replace(/^\n+|\n+$/g, '')
        if (!text) return ''
        const language = getCodeLanguage(element)
        return language ? `\`\`\`${language}\n${text}\n\`\`\`` : `\`\`\`\n${text}\n\`\`\``
    }

    if (tag === 'BLOCKQUOTE') {
        const inner = renderBlocks(Array.from(element.childNodes)).join('\n\n').trim()
        if (!inner) return ''
        return inner
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n')
    }

    if (tag === 'UL' || tag === 'OL') {
        return renderList(element, 0)
    }

    if (tag === 'TABLE') {
        return htmlToText(element.outerHTML, { paragraphSeparator: '\n\n' }).trim()
    }

    if (/^H[1-6]$/.test(tag)) {
        const level = Number(tag[1])
        const text = normalizeInlineMarkdown(renderInlineNodes(Array.from(element.childNodes)))
        if (!text) return ''
        return `${'#'.repeat(level)} ${text}`
    }

    const childBlocks = renderBlocks(Array.from(element.childNodes))
    return childBlocks.join('\n\n').trim()
}

function renderInlineNode(node: Node): string {
    if (node.nodeType === TEXT_NODE) return normalizeText(node.nodeValue ?? '')
    if (node.nodeType !== ELEMENT_NODE) return ''

    const element = node as Element
    const tag = element.tagName
    if (IGNORED_TAGS.has(tag)) return ''

    if (tag === 'BR') return '\n'
    if (tag === 'CODE' && element.parentElement?.tagName !== 'PRE') {
        const text = normalizeText(element.textContent ?? '').replace(/\n+/g, ' ').trim()
        return text ? `\`${text}\`` : ''
    }

    if (tag === 'A') {
        const href = (element.getAttribute('href') ?? '').trim()
        const label = normalizeInlineMarkdown(renderInlineNodes(Array.from(element.childNodes))) || href
        if (!href) return label
        return `[${label}](${href})`
    }

    const inlineContent = renderInlineNodes(Array.from(element.childNodes))
    const style = (element.getAttribute('style') ?? '').toLowerCase()

    if (tag === 'STRONG' || tag === 'B' || /font-weight:\s*(?:bold|[6-9]00)/.test(style)) {
        return wrapInlineMarkdown(inlineContent, '**')
    }
    if (tag === 'EM' || tag === 'I' || /font-style:\s*italic/.test(style)) {
        return wrapInlineMarkdown(inlineContent, '*')
    }
    if (tag === 'S' || tag === 'DEL' || /text-decoration:\s*line-through/.test(style)) {
        return wrapInlineMarkdown(inlineContent, '~~')
    }

    if (BLOCK_TAGS.has(tag)) {
        return renderBlockElement(element)
    }

    return inlineContent
}

function renderList(list: Element, depth: number): string {
    const ordered = list.tagName === 'OL'
    const start = Number(list.getAttribute('start') ?? '1')
    let currentNumber = Number.isFinite(start) && start > 0 ? start : 1

    return Array.from(list.children)
        .filter((child): child is HTMLLIElement => child.tagName === 'LI')
        .map((item) => {
            const marker = ordered ? `${currentNumber++}.` : '-'
            return renderListItem(item, depth, marker)
        })
        .filter(Boolean)
        .join('\n')
}

function renderListItem(item: HTMLLIElement, depth: number, marker: string): string {
    const indent = '  '.repeat(depth)
    let inlineContent = ''
    const nestedBlocks: string[] = []

    for (const child of Array.from(item.childNodes)) {
        if (child.nodeType === ELEMENT_NODE) {
            const element = child as Element
            const tag = element.tagName
            if (tag === 'UL' || tag === 'OL') {
                const nested = renderList(element, depth + 1)
                if (nested) nestedBlocks.push(nested)
                continue
            }
        }

        inlineContent += renderInlineNode(child)
    }

    const content = normalizeInlineMarkdown(inlineContent)
    const head = content ? `${indent}${marker} ${content}` : `${indent}${marker}`

    if (nestedBlocks.length === 0) return head

    const nested = nestedBlocks.join('\n')
    if (!content) return `${head}\n${nested}`
    return `${head}\n${nested}`
}

export function htmlToMarkdown(html: string) {
    if (!html) return ''

    if (typeof window === 'undefined') {
        return normalizeMarkdown(htmlToText(html, { paragraphSeparator: '\n\n' }))
    }

    try {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        return normalizeMarkdown(renderBlocks(Array.from(doc.body.childNodes)).join('\n\n'))
    } catch {
        return normalizeMarkdown(htmlToText(html, { paragraphSeparator: '\n\n' }))
    }
}
