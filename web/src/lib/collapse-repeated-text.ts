/**
 * Drop an exact back-to-back repeat of the same assistant reply.
 * Used when a persisted message already concatenated two copies.
 */
export function collapseRepeatedAssistantText(text: string): string {
    const normalized = text.replace(/\r\n?/g, '\n')
    const trimmed = normalized.trim()
    if (trimmed.length < 80) return text

    const midBreak = trimmed.indexOf('\n\n', Math.floor(trimmed.length * 0.35))
    if (midBreak > 0) {
        const left = trimmed.slice(0, midBreak).trim()
        const right = trimmed.slice(midBreak).trim()
        if (left && left === right) return left
    }

    const half = Math.floor(trimmed.length / 2)
    const left = trimmed.slice(0, half).trim()
    const right = trimmed.slice(half).trim()
    if (left && left === right) return left

    return text
}
