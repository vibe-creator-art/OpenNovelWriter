import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
    CodexToolContext,
    normalizeCodexResponsesTools,
    rewriteCompatibleResponsesResponse,
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

    const restored = rewriteCompatibleResponsesResponse({
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

test('bridges deferred tool_search calls, outputs, and loaded namespace tools', () => {
    const body = {
        tools: [{
            type: 'tool_search',
            execution: 'client',
            description: 'Search available tools.',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string' }, limit: { type: 'integer' } },
                required: ['query'],
            },
        }],
        input: [
            {
                type: 'tool_search_call',
                call_id: 'search_1',
                status: 'completed',
                execution: 'client',
                arguments: { query: 'rename chapter', limit: 2 },
            },
            {
                type: 'tool_search_output',
                call_id: 'search_1',
                status: 'completed',
                execution: 'client',
                tools: [{
                    type: 'namespace',
                    name: 'opennovelwriter',
                    description: 'Novel editing tools.',
                    tools: [{
                        type: 'function',
                        name: 'update_chapter_title',
                        description: 'Rename a chapter.',
                        defer_loading: true,
                        parameters: {
                            type: 'object',
                            properties: { chapterId: { type: 'string' }, title: { type: 'string' } },
                        },
                    }],
                }],
            },
        ],
    }

    const context = CodexToolContext.fromRequest(body)
    const normalized = normalizeCodexResponsesTools(body)
    const tools = normalized.tools as Array<Record<string, unknown>>
    const searchTool = tools.find((tool) => tool.name === 'tool_search')
    const loadedTool = tools.find((tool) => tool.name === 'opennovelwriter__update_chapter_title')

    assert.equal(searchTool?.type, 'function')
    assert.equal(searchTool?.description, 'Search available tools.')
    assert.equal(loadedTool?.type, 'function')
    assert.equal('defer_loading' in (loadedTool ?? {}), false)

    const input = normalized.input as Array<Record<string, unknown>>
    const searchCall = input.find((item) => item.type === 'function_call')
    const searchOutput = input.find((item) => item.type === 'function_call_output')
    assert.equal(searchCall?.name, 'tool_search')
    assert.equal(searchCall?.arguments, '{"query":"rename chapter","limit":2}')
    assert.deepEqual(JSON.parse(String(searchOutput?.output)), {
        loaded_tools: ['opennovelwriter__update_chapter_title'],
    })

    const restored = rewriteCompatibleResponsesResponse({
        type: 'function_call',
        id: 'fc_search_2',
        call_id: 'search_2',
        status: 'completed',
        name: 'tool_search',
        arguments: '{"query":"chapter title","limit":1}',
    }, context) as Record<string, unknown>

    assert.deepEqual(restored, {
        type: 'tool_search_call',
        call_id: 'search_2',
        status: 'completed',
        execution: 'client',
        arguments: { query: 'chapter title', limit: 1 },
    })

    const restoredLoadedTool = rewriteCompatibleResponsesResponse({
        type: 'function_call',
        id: 'fc_edit_1',
        call_id: 'edit_1',
        status: 'completed',
        name: 'opennovelwriter__update_chapter_title',
        arguments: '{"chapterId":"chapter_1","title":"New title"}',
    }, context) as Record<string, unknown>

    assert.equal(restoredLoadedTool.name, 'update_chapter_title')
    assert.equal(restoredLoadedTool.namespace, 'opennovelwriter')
})
