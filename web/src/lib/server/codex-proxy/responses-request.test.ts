import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareCodexResponsesRequest } from './responses-request'

test('Astra forwards Code Mode tools and pending tool history without conversion', () => {
    for (const model of ['gpt-6-astra', 'openai/gpt-6-astra']) {
        const body = {
            model,
            tools: [
                { type: 'custom', name: 'exec', format: { type: 'text' } },
                { type: 'function', name: 'wait', parameters: { type: 'object' } },
                { type: 'function', name: 'request_user_input_async', parameters: { type: 'object' } },
                { type: 'function', name: 'lookup', async: true, parameters: { type: 'object' } },
                { type: 'namespace', name: 'clock', tools: [{ type: 'function', name: 'sleep', parameters: { type: 'object' } }] },
            ],
            input: [
                { type: 'custom_tool_call', name: 'exec', call_id: 'exec_1', input: 'await work();' },
                { type: 'custom_tool_call_output', call_id: 'exec_1', output: 'Script running with cell ID 7' },
                { type: 'function_call', name: 'lookup', call_id: 'pending_1', async: true, status: 'incomplete' },
            ],
        }
        const result = prepareCodexResponsesRequest(body)
        assert.equal(result.body, body)
        assert.equal(result.context, null)
    }
})

test('other models retain their Responses tool conversion', () => {
    for (const model of ['gpt-5.6-sol', 'deepseek-v4-flash']) {
        const body = {
            model,
            tools: [{ type: 'namespace', name: 'mcp', tools: [{ type: 'function', name: 'lookup', parameters: null }] }],
        }
        const result = prepareCodexResponsesRequest(body)
        assert.deepEqual(result.body.tools, [{ type: 'function', name: 'mcp__lookup', parameters: { type: 'object', properties: {} } }])
        assert.equal(result.context?.lookup('mcp__lookup')?.namespace, 'mcp')
    }
})
