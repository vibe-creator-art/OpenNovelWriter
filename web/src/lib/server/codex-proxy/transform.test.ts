import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CodexProviderModel } from '@/lib/codex-config'
import { CodexToolContext } from './tool-context'
import { chatCompletionToResponse, responsesToChatRequest } from './transform'

const model: CodexProviderModel = {
    id: 'chat-model',
    displayName: 'Chat Model',
    contextWindow: 128_000,
    supportedReasoningEfforts: ['high'],
    defaultReasoningEffort: 'high',
    supportsParallelToolCalls: true,
    inputModalities: ['text'],
}

test('keeps namespace conversion inside the Chat Completions bridge', () => {
    const body = {
        model: model.id,
        stream: false,
        input: [
            {
                type: 'additional_tools',
                tools: [{
                    type: 'namespace',
                    name: 'workspace',
                    tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object' } }],
                }],
            },
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read it.' }] },
        ],
    }
    const context = CodexToolContext.fromRequest(body)
    const chat = responsesToChatRequest(body, model, context)

    assert.equal((chat.tools as Array<{ function: { name: string } }>)[0].function.name, 'workspace__read_file')
    assert.deepEqual(chat.messages, [{ role: 'user', content: 'Read it.' }])

    const response = chatCompletionToResponse({
        id: 'chatcmpl_1',
        model: model.id,
        choices: [{
            finish_reason: 'tool_calls',
            message: {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'workspace__read_file', arguments: '{}' } }],
            },
        }],
    }, context)
    assert.deepEqual(response.output, [{
        id: 'fc_call_1',
        type: 'function_call',
        status: 'completed',
        call_id: 'call_1',
        name: 'read_file',
        namespace: 'workspace',
        arguments: '{}',
    }])
})
