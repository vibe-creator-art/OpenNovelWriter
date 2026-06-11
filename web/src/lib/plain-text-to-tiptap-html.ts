function escapeHtml(text: string) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

export function plainTextToTiptapHtml(text: string) {
    const normalized = (text ?? '').replace(/\r\n?/g, '\n').trim()
    if (!normalized) return ''

    const paragraphs = normalized
        .split('\n')
        .map((part) => part.trim())
        .filter(Boolean)

    return paragraphs
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join('')
}
