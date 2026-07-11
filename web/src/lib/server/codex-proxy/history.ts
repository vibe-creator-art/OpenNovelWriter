import { isObject } from '@/lib/server/codex-proxy/tool-context'

type JsonObject = Record<string, unknown>

const MAX_RESPONSES = 512

type CachedResponse = {
    calls: Map<string, JsonObject>
    order: string[]
}

class CodexChatHistoryStore {
    private readonly responses = new Map<string, CachedResponse>()

    record(response: JsonObject) {
        const responseId = typeof response.id === 'string' ? response.id : ''
        const output = Array.isArray(response.output) ? response.output : []
        if (!responseId) return

        const calls = new Map<string, JsonObject>()
        const order: string[] = []
        for (const item of output) {
            if (!isObject(item) || !isCallItem(item)) continue
            const callId = typeof item.call_id === 'string' ? item.call_id : ''
            if (!callId) continue
            calls.set(callId, structuredClone(item))
            order.push(callId)
        }
        if (calls.size === 0) return

        this.responses.delete(responseId)
        this.responses.set(responseId, { calls, order })
        while (this.responses.size > MAX_RESPONSES) {
            const oldest = this.responses.keys().next().value as string | undefined
            if (!oldest) break
            this.responses.delete(oldest)
        }
    }

    enrich(body: JsonObject) {
        const input = Array.isArray(body.input) ? body.input : isObject(body.input) ? [body.input] : null
        if (!input) return body
        const previousId = typeof body.previous_response_id === 'string' ? body.previous_response_id : ''
        const previous = previousId ? this.responses.get(previousId) : undefined
        const existingCallIds = new Set(
            input.filter(isObject).filter(isCallItem).map((item) => String(item.call_id || '')).filter(Boolean)
        )
        const outputCallIds = new Set(
            input.filter(isObject).filter(isCallOutput).map((item) => String(item.call_id || '')).filter(Boolean)
        )

        const restoreGroup: JsonObject[] = []
        const restoreIds = new Set<string>()
        for (const callId of previous?.order ?? []) {
            if (!outputCallIds.has(callId) || existingCallIds.has(callId)) continue
            const cached = previous?.calls.get(callId)
            if (!cached) continue
            restoreGroup.push(structuredClone(cached))
            restoreIds.add(callId)
        }
        for (const callId of outputCallIds) {
            if (existingCallIds.has(callId) || restoreIds.has(callId)) continue
            const cached = this.findUniqueCall(callId)
            if (!cached) continue
            restoreGroup.push(structuredClone(cached))
            restoreIds.add(callId)
        }

        const next: unknown[] = []
        let groupRestored = false
        for (const item of input) {
            if (isObject(item) && isCallItem(item)) {
                const callId = typeof item.call_id === 'string' ? item.call_id : ''
                const cached = callId ? previous?.calls.get(callId) ?? this.findUniqueCall(callId) : undefined
                next.push(cached ? enrichCallItem(item, cached) : item)
                continue
            }
            if (isObject(item) && isCallOutput(item)) {
                if (!groupRestored) {
                    next.push(...restoreGroup)
                    groupRestored = true
                }
            }
            next.push(item)
        }
        return { ...body, input: next }
    }

    private findUniqueCall(callId: string) {
        let found: JsonObject | undefined
        for (const response of this.responses.values()) {
            const candidate = response.calls.get(callId)
            if (!candidate) continue
            if (found) return undefined
            found = candidate
        }
        return found
    }
}

export const codexChatHistory = new CodexChatHistoryStore()

function isCallItem(item: JsonObject) {
    return item.type === 'function_call' || item.type === 'custom_tool_call' || item.type === 'tool_search_call'
}

function isCallOutput(item: JsonObject) {
    return item.type === 'function_call_output' || item.type === 'custom_tool_call_output' || item.type === 'tool_search_output'
}

function enrichCallItem(item: JsonObject, cached: JsonObject) {
    const next = { ...item }
    for (const key of ['name', 'namespace', 'arguments', 'input', 'status', 'execution', 'reasoning_content', 'reasoning']) {
        if (!isEmpty(next[key]) || isEmpty(cached[key])) continue
        next[key] = structuredClone(cached[key])
    }
    return next
}

function isEmpty(value: unknown) {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}
