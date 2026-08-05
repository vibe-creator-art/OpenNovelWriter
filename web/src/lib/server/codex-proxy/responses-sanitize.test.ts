import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sanitizeThirdPartyResponsesRequest } from './responses-sanitize'
import { normalizeCodexResponsesTools } from './tool-context'

test('drops an unbridged private tool_search and normalizes parameter schemas', () => {
    const body = {
        model: 'z-ai/glm-5.2',
        prompt_cache_retention: 'in_memory',
        safety_identifier: 'secret',
        tools: [
            { type: 'tool_search' },
            { type: 'function', name: 'shell', parameters: null },
            {
                type: 'function',
                name: 'broken',
                parameters: { type: null, properties: { path: { type: 'string' } } },
            },
        ],
        input: [
            { type: 'reasoning', content: null, id: 'rs_1', summary: [] },
            { type: 'function_call', status: 'incomplete', name: 'shell', call_id: 'c0', arguments: '{' },
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
        ],
    }

    const result = sanitizeThirdPartyResponsesRequest(body)

    assert.equal('prompt_cache_retention' in result, false)
    assert.equal('safety_identifier' in result, false)
    const tools = result.tools as Array<Record<string, unknown>>
    assert.equal(tools.some((tool) => tool.type === 'tool_search'), false)
    assert.deepEqual(tools.find((tool) => tool.name === 'shell')?.parameters, {
        type: 'object',
        properties: {},
    })
    assert.equal(
        (tools.find((tool) => tool.name === 'broken')?.parameters as { type: string }).type,
        'object',
    )
    const input = result.input as Array<Record<string, unknown>>
    assert.equal(input.some((item) => item.status === 'incomplete'), false)
    assert.equal(input.some((item) => item.type === 'reasoning' && 'content' in item), false)
    assert.equal(input.some((item) => item.type === 'message'), true)
})

test('namespace flatten then sanitize keeps MCP tools for ZenMux-style gateways', () => {
    const body = {
        model: 'z-ai/glm-5.2',
        tools: [{
            type: 'namespace',
            name: 'opennovelwriter',
            tools: [{
                type: 'function',
                name: 'update_chapter_title',
                parameters: { type: null },
            }],
        }],
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'rename' }] }],
    }

    const result = sanitizeThirdPartyResponsesRequest(normalizeCodexResponsesTools(body))
    const tools = result.tools as Array<Record<string, unknown>>
    assert.equal(tools.length, 1)
    assert.equal(tools[0].type, 'function')
    assert.equal(tools[0].name, 'opennovelwriter__update_chapter_title')
    assert.deepEqual(tools[0].parameters, { type: 'object', properties: {} })
})

test('tool_search bridge survives third-party Responses sanitization', () => {
    const body = {
        model: 'deepseek-v4-flash',
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
        input: [{ type: 'message', role: 'user', content: 'rename a chapter' }],
    }

    const result = sanitizeThirdPartyResponsesRequest(normalizeCodexResponsesTools(body))
    const tools = result.tools as Array<Record<string, unknown>>

    assert.deepEqual(tools, [{
        type: 'function',
        name: 'tool_search',
        description: 'Search available tools.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'integer' } },
            required: ['query'],
        },
    }])
})
