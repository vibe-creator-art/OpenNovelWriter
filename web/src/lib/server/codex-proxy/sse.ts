type JsonObject = Record<string, unknown>

export function takeSseBlocks(value: string) {
    const normalized = value.replace(/\r\n/g, '\n')
    const parts = normalized.split('\n\n')
    const remainder = parts.pop() ?? ''
    return { blocks: parts.filter((part) => part.trim()), remainder }
}

export function sseData(block: string) {
    return block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
}

export function isDoneSseBlock(block: string) {
    return sseData(block).trim() === '[DONE]'
}

export function sse(event: string, data: JsonObject) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
