export type CodexResponseAnnotation = {
    text: string
}

export function normalizeCodexResponseAnnotations(value: unknown): CodexResponseAnnotation[] {
    if (!Array.isArray(value)) return []
    return value
        .map((item): CodexResponseAnnotation | null => {
            if (!item || typeof item !== 'object') return null
            const text = typeof (item as { text?: unknown }).text === 'string'
                ? (item as { text: string }).text.trim()
                : ''
            return text ? { text } : null
        })
        .filter((item): item is CodexResponseAnnotation => item !== null)
}

export function prependCodexResponseAnnotations(
    content: string,
    annotations: CodexResponseAnnotation[]
) {
    if (annotations.length === 0) return content
    const payload = JSON.stringify(annotations).replaceAll('<', '\\u003c')
    return [
        '# Response annotations:',
        'Each item contains text selected from an earlier Codex response and may include a user comment. Treat items as Annotation 1, Annotation 2, and so on in array order. Use every selection as context and address every comment. When addressing multiple comments, label each answer with its annotation number (for example, `Annotation 1`) so the user can match it to the numbered annotation.',
        '<response-annotations>',
        payload,
        '</response-annotations>',
        '',
        content,
    ].join('\n')
}
