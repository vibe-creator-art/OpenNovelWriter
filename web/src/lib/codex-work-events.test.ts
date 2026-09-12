import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatWorkEventOutput, getCodexWorkStatus, getWorkEventBody, getWorkEventTitle } from './codex-work-events'
import { parseCodexSessionMessages } from './server/codex-session'

test('activity status follows item lifecycle, exit codes, refusals, and MCP errors', () => {
    assert.equal(getCodexWorkStatus({ status: 'inProgress' }, 'started'), 'running')
    assert.equal(getCodexWorkStatus({}, 'completed'), 'completed')
    assert.equal(getCodexWorkStatus({ status: 'completed', exitCode: 1 }, 'completed'), 'failed')
    assert.equal(getCodexWorkStatus({ status: 'declined' }, 'completed'), 'declined')
    assert.equal(getCodexWorkStatus({ status: 'completed', result: { isError: true } }, 'completed'), 'failed')
    assert.equal(getCodexWorkStatus({ error: { message: 'Unavailable' } }, 'completed'), 'failed')
})

test('saved activity retains status and arguments without changing the raw result', () => {
    const event = { id: 'tool-1', role: 'event', kind: 'tool', content: 'opennovelwriter.query_story_state\n\n{"content":[]}', workStatus: 'failed', toolInput: '{"name":"Mira"}', createdAt: '2026-09-09T00:00:00Z' }
    const [saved] = parseCodexSessionMessages(JSON.stringify([event]))
    assert.equal(saved.workStatus, event.workStatus)
    assert.equal(saved.toolInput, event.toolInput)
    assert.equal(saved.content, event.content)
})

test('MCP text results display as decoded data while retaining access to raw content', () => {
    const raw = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ ok: true, name: '奥瑞利亚' }) }] })
    const content = `opennovelwriter.query_story_state\n\n${raw}`
    assert.equal(getWorkEventTitle(content), 'opennovelwriter.query_story_state')
    assert.equal(getWorkEventBody(content), raw)
    assert.equal(formatWorkEventOutput(raw), '{\n  "ok": true,\n  "name": "奥瑞利亚"\n}')
    assert.equal(formatWorkEventOutput('line one\n\nline two'), 'line one\n\nline two')
    assert.equal(getWorkEventBody('No output yet'), '')
})

test('very large results skip eager JSON decoding', () => {
    const raw = JSON.stringify({ content: [{ type: 'text', text: 'x'.repeat(256_000) }] })
    assert.equal(formatWorkEventOutput(raw), raw)
})
