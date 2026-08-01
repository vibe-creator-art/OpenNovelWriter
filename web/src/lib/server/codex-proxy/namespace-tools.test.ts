import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
    CodexToolContext,
    normalizeCodexResponsesTools,
    rewriteNamespacedResponse,
} from './tool-context'

test('promotes additional_tools and flattens MCP namespaces for native Responses', () => {
    const body = {
        model: 'deepseek-v4-flash',
        tools: [
            { type: 'function', name: 'shell', parameters: { type: 'object' } },
        ],
        input: [
            {
                type: 'additional_tools',
                tools: [{
                    type: 'namespace',
                    name: 'opennovelwriter',
                    tools: [{
                        type: 'function',
                        name: 'update_chapter_title',
                        description: 'Rename a chapter',
                        parameters: {
                            type: 'object',
                            properties: { chapterId: { type: 'string' }, title: { type: 'string' } },
                        },
                    }],
                }],
            },
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'rename chapter' }] },
            {
                type: 'function_call',
                call_id: 'call_1',
                name: 'update_chapter_title',
                namespace: 'opennovelwriter',
                arguments: '{"chapterId":"c1","title":"相知相遇"}',
            },
        ],
    }

    const context = CodexToolContext.fromRequest(body)
    const normalized = normalizeCodexResponsesTools(body)

    assert.equal(Array.isArray(normalized.input) && normalized.input.some((item) => (
        typeof item === 'object' && item !== null && (item as { type?: string }).type === 'additional_tools'
    )), false)

    const tools = normalized.tools as Array<{ type?: string; name?: string }>
    assert.ok(tools.some((tool) => tool.name === 'shell'))
    assert.ok(tools.some((tool) => tool.type === 'function' && tool.name === 'opennovelwriter__update_chapter_title'))
    assert.equal(tools.some((tool) => tool.type === 'namespace'), false)

    const historyCall = (normalized.input as Array<Record<string, unknown>>).find((item) => item.type === 'function_call')
    assert.equal(historyCall?.name, 'opennovelwriter__update_chapter_title')
    assert.equal(historyCall?.namespace, undefined)

    const restored = rewriteNamespacedResponse({
        type: 'function_call',
        name: 'opennovelwriter__update_chapter_title',
        call_id: 'call_1',
        arguments: '{"chapterId":"c1","title":"相知相遇"}',
    }, context) as Record<string, unknown>

    assert.equal(restored.name, 'update_chapter_title')
    assert.equal(restored.namespace, 'opennovelwriter')
})

test('flattens namespaces already present on the top-level tools array', () => {
    const body = {
        tools: [{
            type: 'namespace',
            name: 'opennovelwriter',
            tools: [{ type: 'function', name: 'update_chapter_title', parameters: { type: 'object' } }],
        }],
        input: [{ type: 'message', role: 'user', content: 'hi' }],
    }

    const normalized = normalizeCodexResponsesTools(body)
    const tools = normalized.tools as Array<{ type?: string; name?: string }>
    assert.deepEqual(tools.map((tool) => tool.name), ['opennovelwriter__update_chapter_title'])
    assert.equal(tools[0]?.type, 'function')
})
