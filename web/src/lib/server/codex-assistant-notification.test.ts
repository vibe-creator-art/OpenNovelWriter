import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { parseCodexAssistantNotification } from './codex-assistant-notification'

describe('parseCodexAssistantNotification', () => {
    test('parses output emitted by notify()', () => {
        assert.deepEqual(parseCodexAssistantNotification({
            type: 'custom_tool_call_output',
            id: 'notification-1',
            call_id: 'call-1',
            name: 'exec',
            output: '1',
        }), {
            id: 'notification-1',
            content: '1',
        })
    })

    test('joins text content items', () => {
        assert.deepEqual(parseCodexAssistantNotification({
            type: 'custom_tool_call_output',
            id: 'notification-2',
            name: 'exec',
            output: [
                { type: 'input_text', text: 'first' },
                { type: 'input_image', image_url: 'data:image/png;base64,AA==' },
                { type: 'input_text', text: 'second' },
            ],
        }), {
            id: 'notification-2',
            content: 'first\nsecond',
        })
    })

    test('ignores ordinary custom tool completion output', () => {
        assert.equal(parseCodexAssistantNotification({
            type: 'custom_tool_call_output',
            id: 'tool-output-1',
            name: null,
            output: 'Script completed',
        }), null)
    })
})
