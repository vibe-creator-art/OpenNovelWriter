export type CodexResponseAnnotation = {
    text: string
    annotation?: string
    source?: {
        messageId: string
        /** UTF-16 offsets in the rendered response's text nodes. */
        startOffset: number
        endOffset: number
    }
}

export function getCodexAnnotationReferences(messages: {
    id: string
    role: string
    kind?: string | null
    responseAnnotations?: CodexResponseAnnotation[]
}[]) {
    const references = new Map<string, CodexResponseAnnotation[]>()
    let current: CodexResponseAnnotation[] = []
    for (const message of messages) {
        if (message.role === 'user') current = message.responseAnnotations ?? []
        if (message.role === 'event' && message.kind === 'steer' && message.responseAnnotations?.length) {
            current = message.responseAnnotations
        }
        if (message.role === 'assistant') references.set(message.id, current)
    }
    return references
}

export function normalizeCodexResponseAnnotations(value: unknown): CodexResponseAnnotation[] {
    if (!Array.isArray(value)) return []
    return value
        .map((item): CodexResponseAnnotation | null => {
            if (!item || typeof item !== 'object') return null
            const record = item as Record<string, unknown>
            const text = typeof record.text === 'string' ? record.text.trim() : ''
            if (!text) return null
            const annotation = typeof record.annotation === 'string' ? record.annotation.trim() : ''
            const source = record.source as Partial<NonNullable<CodexResponseAnnotation['source']>> | null
            const validSource = source && typeof source.messageId === 'string' && source.messageId.trim()
                && Number.isSafeInteger(source.startOffset) && Number.isSafeInteger(source.endOffset)
                && source.startOffset! >= 0 && source.endOffset! > source.startOffset!
            return {
                text,
                ...(annotation ? { annotation } : {}),
                ...(validSource ? { source: {
                    messageId: source.messageId!,
                    startOffset: source.startOffset!,
                    endOffset: source.endOffset!,
                } } : {}),
            }
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
        'Each item contains text selected from an earlier Codex response and may include a user comment. Treat items as Annotation 1, Annotation 2, and so on in array order. Use every selection as context and address every comment. For every annotation you address, include its inline directive `:codex-annotation{index="N"}`, where N is its one-based array position (for example, `:codex-annotation{index="1"}`). Do not use unstructured annotation labels.',
        '<response-annotations>',
        payload,
        '</response-annotations>',
        '',
        content,
    ].join('\n')
}
