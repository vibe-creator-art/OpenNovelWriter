export type LlmConversationRole = 'system' | 'user' | 'assistant'

export type LlmConversationBlock = {
    role: LlmConversationRole
    content: string
}

const ROLE_HEADING = /^#{1,6}\s+(system|user|assistant)\b.*$/i

/**
 * Parse a Codex LLM-conversation artifact (Markdown) into ordered role blocks.
 *
 * The format is a sequence of level-1..6 headings naming a role, followed by that
 * turn's content:
 *
 *     ## system
 *     You are ...
 *     ## user
 *     Write ...
 *     ## assistant
 *     (model reply)
 *
 * Any content before the first role heading is ignored (it may be a title or notes).
 */
export function parseLlmConversation(markdown: string): LlmConversationBlock[] {
    const normalized = markdown.replace(/\r\n?/g, '\n')
    const lines = normalized.split('\n')
    const blocks: LlmConversationBlock[] = []

    let role: LlmConversationRole | null = null
    let buffer: string[] = []

    const flush = () => {
        if (role) blocks.push({ role, content: buffer.join('\n').trim() })
        buffer = []
    }

    for (const line of lines) {
        const match = line.match(ROLE_HEADING)
        if (match) {
            flush()
            role = match[1].toLowerCase() as LlmConversationRole
            continue
        }
        if (role) buffer.push(line)
    }
    flush()

    return blocks
}

export type LlmRequestPayload = {
    system: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

/**
 * Split parsed blocks into a system prompt (all system blocks joined) and the
 * user/assistant message turns, ready to send to a model group.
 */
export function buildLlmRequestPayload(blocks: LlmConversationBlock[]): LlmRequestPayload {
    const system = blocks
        .filter((block) => block.role === 'system')
        .map((block) => block.content)
        .filter(Boolean)
        .join('\n\n')

    const messages = blocks
        .filter((block): block is LlmConversationBlock & { role: 'user' | 'assistant' } =>
            block.role === 'user' || block.role === 'assistant'
        )
        .map((block) => ({ role: block.role, content: block.content }))

    return { system, messages }
}

/**
 * Resolve an assistant block by index. Defaults to -1 (the latest assistant turn).
 * Supports negative indexing from the end. Returns null when out of range.
 */
export function getAssistantBlock(
    blocks: LlmConversationBlock[],
    index = -1
): { content: string; index: number; total: number } | null {
    const assistants = blocks.filter((block) => block.role === 'assistant')
    const total = assistants.length
    if (total === 0) return null

    const resolved = index < 0 ? total + index : index
    if (resolved < 0 || resolved >= total) return null

    return { content: assistants[resolved].content, index: resolved, total }
}
