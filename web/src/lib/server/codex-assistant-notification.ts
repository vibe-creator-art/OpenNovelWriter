export type CodexAssistantNotification = {
    id: string | null
    content: string
}

export function parseCodexAssistantNotification(item: unknown): CodexAssistantNotification | null {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    if (record.type !== 'custom_tool_call_output') return null
    if (typeof record.name !== 'string' || !record.name.trim()) return null

    const content = typeof record.output === 'string'
        ? record.output.trim()
        : Array.isArray(record.output)
            ? record.output
                .map((part) => {
                    if (!part || typeof part !== 'object') return ''
                    const contentPart = part as Record<string, unknown>
                    return contentPart.type === 'input_text' && typeof contentPart.text === 'string'
                        ? contentPart.text
                        : ''
                })
                .filter(Boolean)
                .join('\n')
                .trim()
            : ''
    if (!content) return null

    return {
        id: typeof record.id === 'string' && record.id ? record.id : null,
        content,
    }
}
