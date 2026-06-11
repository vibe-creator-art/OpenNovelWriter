/* eslint-disable @typescript-eslint/no-require-imports */
// CommonJS twin of llm-conversation.ts for the Codex MCP subprocess.
// Keep the parsing rules in sync with ../llm-conversation.ts.

const ROLE_HEADING = /^#{1,6}\s+(system|user|assistant)\b.*$/i

function parseLlmConversation(markdown) {
    const normalized = String(markdown ?? '').replace(/\r\n?/g, '\n')
    const lines = normalized.split('\n')
    const blocks = []

    let role = null
    let buffer = []

    const flush = () => {
        if (role) blocks.push({ role, content: buffer.join('\n').trim() })
        buffer = []
    }

    for (const line of lines) {
        const match = line.match(ROLE_HEADING)
        if (match) {
            flush()
            role = match[1].toLowerCase()
            continue
        }
        if (role) buffer.push(line)
    }
    flush()

    return blocks
}

function buildLlmRequestPayload(blocks) {
    const system = blocks
        .filter((block) => block.role === 'system')
        .map((block) => block.content)
        .filter(Boolean)
        .join('\n\n')

    const messages = blocks
        .filter((block) => block.role === 'user' || block.role === 'assistant')
        .map((block) => ({ role: block.role, content: block.content }))

    return { system, messages }
}

// Resolve an assistant block by index. Defaults to -1 (the latest assistant turn).
// Supports negative indexing from the end. Returns null when out of range.
// Keep in sync with ../llm-conversation.ts.
function getAssistantBlock(blocks, index = -1) {
    const assistants = blocks.filter((block) => block.role === 'assistant')
    const total = assistants.length
    if (total === 0) return null

    const resolved = index < 0 ? total + index : index
    if (resolved < 0 || resolved >= total) return null

    return { content: assistants[resolved].content, index: resolved, total }
}

module.exports = { parseLlmConversation, buildLlmRequestPayload, getAssistantBlock }
