import type { CodexResponseAnnotation } from '@/lib/codex-response-annotations'

function textNodes(root: HTMLElement) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.parentElement?.closest('[data-codex-annotation-ui]')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
    })
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    return nodes
}

export function captureCodexAnnotation(root: HTMLElement, messageId: string, selection: Selection | null): CodexResponseAnnotation | null {
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return null
    if (range.cloneContents().querySelector('[data-codex-annotation-ui]')) return null
    const raw = range.toString()
    const text = selection.toString().trim()
    if (!text) return null
    const prefix = range.cloneRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(range.startContainer, range.startOffset)
    const fragment = prefix.cloneContents()
    fragment.querySelectorAll('[data-codex-annotation-ui]').forEach((node) => node.remove())
    const startOffset = (fragment.textContent?.length ?? 0) + raw.length - raw.trimStart().length
    return { text, source: { messageId, startOffset, endOffset: startOffset + raw.trim().length } }
}

export function resolveCodexAnnotationRange(root: HTMLElement, annotation: CodexResponseAnnotation): Range | null {
    const source = annotation.source
    if (!source) return null
    const range = document.createRange()
    let offset = 0
    let started = false
    for (const node of textNodes(root)) {
        const end = offset + node.length
        if (!started && source.startOffset < end) {
            range.setStart(node, source.startOffset - offset)
            started = true
        }
        if (started && source.endOffset <= end) {
            range.setEnd(node, source.endOffset - offset)
            return range.toString().replace(/\s/gu, '') === annotation.text.replace(/\s/gu, '') ? range : null
        }
        offset = end
    }
    return null
}
