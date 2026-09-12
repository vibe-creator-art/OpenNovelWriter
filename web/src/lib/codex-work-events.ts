import type { SceneEditToolResult } from '@/lib/codex-scene-edit'

export type CodexWorkStatus = 'running' | 'completed' | 'failed' | 'declined'

export type CodexWorkMetadata = {
    workStatus?: CodexWorkStatus
    toolInput?: string
    detailVersion?: string
    sceneEdit?: SceneEditToolResult
}

export function getCodexWorkStatus(item: Record<string, unknown>, phase: 'started' | 'completed'): CodexWorkStatus {
    if (item.status === 'declined') return 'declined'
    const result = item.result as Record<string, unknown> | null | undefined
    if (item.status === 'failed' || item.error || result?.isError === true || (typeof item.exitCode === 'number' && item.exitCode !== 0)) return 'failed'
    return phase === 'started' ? 'running' : 'completed'
}

export function getWorkEventTitle(content: string) {
    const separator = content.indexOf('\n\n')
    return separator < 0 ? content : content.slice(0, separator)
}

export function getWorkEventBody(content: string) {
    const separator = content.indexOf('\n\n')
    return separator < 0 ? '' : content.slice(separator + 2)
}

/** Decode MCP text envelopes only when their details are opened. */
export function formatWorkEventOutput(value: string, depth = 0): string {
    if (depth >= 4 || value.length > 128_000) return value
    try {
        const parsed: unknown = JSON.parse(value)
        if (typeof parsed === 'string') return formatWorkEventOutput(parsed, depth + 1)
        if (parsed && typeof parsed === 'object' && 'content' in parsed && Array.isArray(parsed.content)) {
            return parsed.content.map((block: unknown) => {
                if (block && typeof block === 'object' && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string') {
                    return formatWorkEventOutput(block.text, depth + 1)
                }
                return JSON.stringify(block, null, 2)
            }).join('\n\n')
        }
        return JSON.stringify(parsed, null, 2)
    } catch {
        return value
    }
}
