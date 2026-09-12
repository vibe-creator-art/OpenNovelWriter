import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { CodexSessionMessage } from '@/lib/api'
import translations from '@/messages/en.json'
import { CodexReasoningBlock } from './codex-reasoning-block'
import { CodexTurnGroup } from './right-panel-codex'

const thought: CodexSessionMessage = { id: 'reasoning', role: 'event', kind: 'reasoning', workStatus: 'running', content: 'Consider the **character**.', createdAt: '2026-09-11T12:00:00Z' }
const user: CodexSessionMessage = { id: 'user', role: 'user', content: 'Write a scene', createdAt: thought.createdAt }

test('live reasoning expands, completed reasoning collapses, and explicit choices win', () => {
    const render = (running: boolean, expanded: boolean | undefined, message = thought) => renderToStaticMarkup(
        <NextIntlClientProvider locale="en" messages={translations} timeZone="UTC">
            <CodexReasoningBlock message={message} running={running} expanded={expanded} onExpandedChange={() => {}} />
        </NextIntlClientProvider>
    )
    assert.match(render(true, undefined), /Thinking…/)
    assert.match(render(true, undefined), /<strong[^>]*>character<\/strong>/)
    assert.doesNotMatch(render(false, undefined), /Consider the/)
    assert.doesNotMatch(render(true, undefined, { ...thought, workStatus: 'completed' }), /Consider the/)
    assert.doesNotMatch(render(true, false), /Consider the/)
    assert.match(render(false, true), /Consider the/)
    assert.equal(render(true, undefined, { ...thought, content: '' }), '')
})

test('the actual turn renderer hides reasoning when disabled and preserves tool order when enabled', () => {
    const tool: CodexSessionMessage = { id: 'tool', role: 'event', kind: 'tool', workStatus: 'completed', content: 'Read manuscript\n\nResult', createdAt: thought.createdAt }
    const nextThought = { ...thought, id: 'next-reasoning', content: 'Continue thinking' }
    const messages = [user, thought, tool, nextThought]
    const render = (showReasoning: boolean) => renderToStaticMarkup(
        <NextIntlClientProvider locale="en" messages={translations} timeZone="UTC">
            <CodexTurnGroup messages={messages} running showReasoning={showReasoning} />
        </NextIntlClientProvider>
    )
    assert.doesNotMatch(render(false), /data-codex-reasoning|Consider the|Continue thinking/)
    const html = render(true)
    assert.ok(html.indexOf('data-codex-reasoning="reasoning"') < html.indexOf('data-work-group="tool"'))
    assert.ok(html.indexOf('data-work-group="tool"') < html.indexOf('data-codex-reasoning="next-reasoning"'))
})

test('completed turns expose the collapsed reasoning control without a second disclosure', () => {
    const html = renderToStaticMarkup(
        <NextIntlClientProvider locale="en" messages={translations} timeZone="UTC">
            <CodexTurnGroup messages={[user, { ...thought, workStatus: 'completed' }, { ...user, id: 'answer', role: 'assistant', content: 'Final scene' }]} running={false} showReasoning />
        </NextIntlClientProvider>
    )
    assert.match(html, /data-codex-reasoning="reasoning"/)
    assert.doesNotMatch(html, /Consider the/)
    assert.match(html, /Final scene/)
})

test('the turn renderer routes viewed images through the compact activity group', () => {
    const viewedImage: CodexSessionMessage = { id: 'view-image', role: 'event', kind: 'image_view', content: 'Viewed image\n\n/workspace/portrait.png', createdAt: thought.createdAt }
    const html = renderToStaticMarkup(
        <NextIntlClientProvider locale="en" messages={translations} timeZone="UTC">
            <CodexTurnGroup messages={[user, viewedImage]} running showReasoning={false} />
        </NextIntlClientProvider>
    )
    assert.match(html, /data-work-group="view-image"/)
    assert.match(html, /Viewed images/)
    assert.doesNotMatch(html, /\/workspace\/portrait.png|image_view/)
})
