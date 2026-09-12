import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { CodexSessionMessage } from '@/lib/api'
import translations from '@/messages/en.json'
import { CodexWorkEventGroup, type WorkGroupState } from './codex-work-events'

const messages: CodexSessionMessage[] = Array.from({ length: 17 }, (_,index) => ({
    id: `tool-${index}`, role: 'event', kind: 'tool', workStatus: 'completed',
    content: `opennovelwriter.query_story_state\n\n${JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ marker: 'PRIVATE_TOOL_OUTPUT', text: 'x'.repeat(20_000) }) }] })}`,
    createdAt: '2026-09-09T00:00:00Z',
}))

function render(state: WorkGroupState, items = messages, running = false) {
    return renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={translations} timeZone="UTC">
        <CodexWorkEventGroup messages={items} running={running} state={state} onChange={() => {}} />
    </NextIntlClientProvider>)
}

test('expanding a 17-call group mounts rows without their result bodies', () => {
    const collapsed = render({ expanded: false, openItemId: null })
    const expanded = render({ expanded: true, openItemId: null })
    assert.equal((collapsed.match(/<button/g) ?? []).length, 1)
    assert.equal((expanded.match(/<button/g) ?? []).length, 18)
    assert.doesNotMatch(collapsed + expanded, /PRIVATE_TOOL_OUTPUT|<pre|data-work-details/)
})

test('opening one call mounts one bounded detail panel and decodes the MCP envelope', () => {
    const html = render({ expanded: true, openItemId: 'tool-4' })
    assert.equal((html.match(/data-work-details/g) ?? []).length, 1)
    assert.match(html, /PRIVATE_TOOL_OUTPUT/)
    assert.match(html, /Show more/)
    assert.doesNotMatch(html, /x{4001}/)
})

test('opening a deferred tool displays loading until its detail request completes', () => {
    const message = { ...messages[0], content: 'opennovelwriter.query_story_state', detailVersion: 'v1' }
    const html = render({ expanded: true, openItemId: message.id }, [message])
    assert.match(html, /Loading/)
    assert.doesNotMatch(html, /PRIVATE_TOOL_OUTPUT|<pre/)
})

test('running calls share one compact status row and stop animating after the run ends', () => {
    const active = messages.slice(0, 2).map((message) => ({ ...message, workStatus: 'running' as const }))
    const html = render({ expanded: false, openItemId: null }, active, true)
    assert.equal((html.match(/<button/g) ?? []).length, 1)
    assert.match(html, /\+1 running/)
    assert.match(html, /codex-activity-running/)
    const stopped = render({ expanded: false, openItemId: null }, active, false)
    assert.doesNotMatch(stopped, /codex-activity-running/)
    assert.match(stopped, /2 stopped/)
})

for (const workStatus of ['failed', 'declined'] as const) {
    test(`${workStatus} attempts show their status only inside command details`, () => {
        const attempt: CodexSessionMessage = {
            ...messages[0], kind: 'command', workStatus,
            content: 'sed -n 1,240p skills/edit-manuscript/SKILL.md\n\nsed: skills/edit-manuscript/SKILL.md: No such file or directory',
        }
        const items = [attempt, messages[1]]
        const collapsed = render({ expanded: false, openItemId: null }, items)
        const expanded = render({ expanded: true, openItemId: null }, items)
        assert.doesNotMatch(collapsed + expanded, /Failed|Declined|text-destructive|lucide-circle-alert|No such file or directory/)
        const details = render({ expanded: true, openItemId: attempt.id }, items)
        assert.match(details, new RegExp(workStatus === 'failed' ? 'Failed' : 'Declined'))
        assert.match(details, /No such file or directory/)
        assert.equal(attempt.workStatus, workStatus)
    })
}

test('viewed images use compact rows and reveal their paths only in details', () => {
    const path = '/workspace/artifacts/images/portrait.png'
    const message: CodexSessionMessage = { id: 'image', role: 'event', kind: 'image_view', content: `Viewed image\n\n${path}`, createdAt: '2026-09-11T00:00:00Z' }
    const collapsed = render({ expanded: false, openItemId: null }, [message])
    assert.equal((collapsed.match(/<button/g) ?? []).length, 1)
    assert.match(collapsed, /Viewed images/)
    assert.doesNotMatch(collapsed, /data-work-details|\/workspace|image_view/)
    const expanded = render({ expanded: true, openItemId: null }, [message])
    assert.match(expanded, /Viewed image: portrait.png/)
    assert.doesNotMatch(expanded, /data-work-details|\/workspace/)
    const details = render({ expanded: true, openItemId: message.id }, [message])
    assert.match(details, /data-work-details/)
    assert.ok(details.includes(path))
    const active = render({ expanded: false, openItemId: null }, [{ ...message, workStatus: 'running' }], true)
    assert.match(active, /Viewing image: portrait.png/)
})
