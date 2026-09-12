import { isObject } from './tool-context'

type JsonObject = Record<string, unknown>

const SEARCH_REPLAY_PREFIX = 'opennovelwriter-anthropic-web-search-v1:'

export function anthropicWebSearchTool(body: JsonObject) {
    const tool = Array.isArray(body.tools) ? body.tools.find((tool) => isObject(tool) && tool.type === 'web_search') : null
    if (!isObject(tool)) return null
    const result: JsonObject = { type: 'web_search_20250305', name: 'web_search' }
    if (isObject(tool.filters) && Array.isArray(tool.filters.allowed_domains)) {
        result.allowed_domains = tool.filters.allowed_domains
    }
    if (typeof body.max_tool_calls === 'number' && body.max_tool_calls > 0) result.max_uses = body.max_tool_calls
    return result
}

export function anthropicWebSearchItem(call: JsonObject, result?: JsonObject) {
    const query = isObject(call.input) && typeof call.input.query === 'string' ? call.input.query : ''
    const content = result?.content
    const failed = isObject(content)
        ? content.type === 'web_search_tool_result_error'
        : Array.isArray(content) && content.some((item) => isObject(item) && item.type === 'web_search_tool_result_error')
    return {
        id: `ws_${call.id}`,
        type: 'web_search_call',
        status: !result ? 'in_progress' : failed ? 'failed' : 'completed',
        action: { type: 'search', query, queries: query ? [query] : [] },
    }
}

/** Preserve server search blocks for subsequent Anthropic requests. */
export function anthropicWebSearchReplayItem(call: JsonObject, result: JsonObject) {
    return {
        id: `rs_ws_${call.id}`,
        type: 'reasoning',
        summary: [],
        encrypted_content: `${SEARCH_REPLAY_PREFIX}${Buffer.from(JSON.stringify([call, result])).toString('base64url')}`,
    }
}

export function decodeAnthropicWebSearch(value: string): JsonObject[] | null {
    if (!value.startsWith(SEARCH_REPLAY_PREFIX)) return null
    try {
        const blocks: unknown = JSON.parse(Buffer.from(value.slice(SEARCH_REPLAY_PREFIX.length), 'base64url').toString('utf8'))
        return Array.isArray(blocks) && blocks.every(isObject) ? blocks : null
    } catch {
        return null
    }
}

export function needsAnthropicSearchContinuation(stopReason: string, content: JsonObject[]) {
    if (!content.some((block) => block.type === 'server_tool_use' && block.name === 'web_search')) return false
    if (content.some((block) => block.type === 'tool_use')) return false
    return stopReason === 'pause_turn' || (stopReason === 'tool_use' && content.at(-1)?.type === 'web_search_tool_result')
}

export class AnthropicWebCitations {
    private readonly numbers = new Map<string, number>()
    private nextNumber = 1

    render(citations: unknown, text: string) {
        for (const match of text.matchAll(/\[\[(\d+)\]\]\((https?:\/\/[^\s]+)\)/g)) {
            const number = Number(match[1])
            this.numbers.set(match[2], number)
            this.nextNumber = Math.max(this.nextNumber, number + 1)
        }
        if (!Array.isArray(citations)) return ''
        const links: string[] = []
        for (const citation of citations) {
            if (!isObject(citation) || citation.type !== 'web_search_result_location' || typeof citation.url !== 'string') continue
            let url: string
            try {
                const parsed = new URL(citation.url)
                if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue
                url = parsed.href.replace(/\(/g, '%28').replace(/\)/g, '%29')
            } catch {
                continue
            }
            if (text.includes(`](${url})`)) continue
            let number = this.numbers.get(url)
            if (number === undefined) {
                number = this.nextNumber++
                this.numbers.set(url, number)
            }
            const link = `[[${number}]](${url})`
            if (!links.includes(link)) links.push(link)
        }
        return links.join('')
    }
}
