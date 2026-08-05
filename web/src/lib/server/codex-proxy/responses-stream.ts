import { sseData, takeSseBlocks } from '@/lib/server/codex-proxy/sse'
import { CodexToolContext, rewriteCompatibleResponsesResponse } from '@/lib/server/codex-proxy/tool-context'

export function createResponsesToolStream(input: {
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
    const data = sseData(block)
    if (!data || data === '[DONE]') return `${block.trimEnd()}\n\n`
    try {
        const parsed = JSON.parse(data) as unknown
        const prefix = block
            .split(/\r?\n/)
            .filter((line) => !line.startsWith('data:') && line.trim())
            .join('\n')
        const rewritten = `data: ${JSON.stringify(rewriteCompatibleResponsesResponse(parsed, context))}`
        return `${prefix ? `${prefix}\n` : ''}${rewritten}\n\n`
    } catch {
        return `${block.trimEnd()}\n\n`
    }
}
