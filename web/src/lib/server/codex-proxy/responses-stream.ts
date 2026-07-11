import { CodexToolContext, rewriteNamespacedResponse } from '@/lib/server/codex-proxy/tool-context'

export function createResponsesNamespaceStream(input: {
    upstream: ReadableStream<Uint8Array>
    context: CodexToolContext
}) {
    const reader = input.upstream.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffer = ''

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            while (true) {
                const { done, value } = await reader.read()
                if (value) buffer += decoder.decode(value, { stream: !done })
                const blocks = takeSseBlocks(buffer)
                buffer = blocks.remainder
                for (const block of blocks.blocks) controller.enqueue(encoder.encode(rewriteBlock(block, input.context)))
                if (!done) {
                    if (blocks.blocks.length > 0) return
                    continue
                }
                if (buffer.trim()) controller.enqueue(encoder.encode(rewriteBlock(buffer, input.context)))
                controller.close()
                return
            }
        },
        cancel() {
            void reader.cancel()
        },
    })
}

function rewriteBlock(block: string, context: CodexToolContext) {
    const lines = block.split(/\r?\n/)
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') return `${block.trimEnd()}\n\n`
    try {
        const parsed = JSON.parse(data) as unknown
        const prefix = lines.filter((line) => !line.startsWith('data:') && line.trim()).join('\n')
        const rewritten = `data: ${JSON.stringify(rewriteNamespacedResponse(parsed, context))}`
        return `${prefix ? `${prefix}\n` : ''}${rewritten}\n\n`
    } catch {
        return `${block.trimEnd()}\n\n`
    }
}

function takeSseBlocks(value: string) {
    const normalized = value.replace(/\r\n/g, '\n')
    const parts = normalized.split('\n\n')
    const remainder = parts.pop() ?? ''
    return { blocks: parts.filter((part) => part.trim()), remainder }
}
