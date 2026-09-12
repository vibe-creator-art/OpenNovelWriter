export type CodexReasoningDelta = { id: string; delta: string; createdAt: string }

type ReasoningState = {
    summary: string[]
    content: string[]
    text: string
    createdAt: string
}

type ReasoningUpdate =
    | { type: 'delta'; value: CodexReasoningDelta }
    | { type: 'event'; value: { id: string; kind: 'reasoning'; title: string; content: string; workStatus: 'running' | 'completed'; createdAt: string } }

function textParts(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((part): part is string => typeof part === 'string') : []
}

export class CodexReasoningStream {
    private readonly items = new Map<string, ReasoningState>()

    consume(method: string, params: Record<string, unknown>): ReasoningUpdate | null {
        const item = params.item && typeof params.item === 'object' ? params.item as Record<string, unknown> : null
        const lifecycle = (method === 'item/started' || method === 'item/completed') && item?.type === 'reasoning'
        const delta = method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta'
        const boundary = method === 'item/reasoning/summaryPartAdded'
        if (!lifecycle && !delta && !boundary) return null
        const id = lifecycle ? item?.id : params.itemId
        if (typeof id !== 'string') return null
        const state = this.items.get(id) ?? { summary: [], content: [], text: '', createdAt: new Date().toISOString() }
        this.items.set(id, state)
        const completed = method === 'item/completed'
        if (lifecycle) {
            state.summary = textParts(item?.summary)
            state.content = textParts(item?.content)
        } else {
            const raw = method === 'item/reasoning/textDelta'
            const index = raw ? params.contentIndex : params.summaryIndex
            if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
            const parts = raw ? state.content : state.summary
            if (delta && typeof params.delta === 'string') parts[index] = (parts[index] ?? '') + params.delta
            else if (boundary) parts[index] ??= ''
        }
        const rawText = state.content.join('\n\n')
        const text = rawText.trim() ? rawText : state.summary.join('\n\n')
        const previous = state.text
        state.text = text
        if (!completed && text === previous) return null
        if (!completed && text.startsWith(previous)) {
            return { type: 'delta', value: { id, delta: text.slice(previous.length), createdAt: state.createdAt } }
        }
        if (completed) this.items.delete(id)
        return {
            type: 'event',
            value: { id, kind: 'reasoning', title: '', content: text, workStatus: completed ? 'completed' : 'running', createdAt: state.createdAt },
        }
    }
}
