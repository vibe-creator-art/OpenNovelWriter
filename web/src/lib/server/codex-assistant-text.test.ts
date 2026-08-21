import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collapseRepeatedAssistantText, mergeCompletedAssistantText } from './codex-assistant-text'

test('keeps an already-complete streamed reply', () => {
    assert.deepEqual(mergeCompletedAssistantText('full answer', 'full answer'), {
        assistantText: 'full answer',
        delta: '',
    })
})

test('emits the remainder when a preamble was streamed first', () => {
    const preamble = '我先查一下火焰纹章最新作的官方发售信息。'
    const completed = `${preamble}火焰纹章系列目前最新作是 Fortune's Weave。`
    assert.deepEqual(mergeCompletedAssistantText(preamble, completed), {
        assistantText: completed,
        delta: '火焰纹章系列目前最新作是 Fortune\'s Weave。',
    })
})

test('uses the completed item when nothing streamed', () => {
    assert.deepEqual(mergeCompletedAssistantText('', 'final answer'), {
        assistantText: 'final answer',
        delta: 'final answer',
    })
})

test('keeps extra streamed text when it already extends the completed item', () => {
    assert.deepEqual(mergeCompletedAssistantText('hello world', 'hello'), {
        assistantText: 'hello world',
        delta: '',
    })
})

test('appends a distinct completed message after a preamble', () => {
    assert.deepEqual(mergeCompletedAssistantText('looking it up.', 'Release date: 2026-09-17.'), {
        assistantText: 'looking it up.Release date: 2026-09-17.',
        delta: 'Release date: 2026-09-17.',
    })
})

test('does not duplicate a completed reply that only differs by whitespace', () => {
    const reply = '查到了。火焰纹章系列最新作是 Fortune\'s Weave，2026年9月17日发售。'
    assert.deepEqual(mergeCompletedAssistantText(`${reply}\n`, reply), {
        assistantText: `${reply}\n`,
        delta: '',
    })
})

test('does not append a completed reply that is already the streamed suffix', () => {
    const reply = '查到了。火焰纹章系列最新作是 Fortune\'s Weave，2026年9月17日发售。'
    assert.deepEqual(mergeCompletedAssistantText(`${reply}\n\n${reply}`, reply), {
        assistantText: `${reply}\n\n${reply}`,
        delta: '',
    })
})

test('collapses an already-duplicated assistant message', () => {
    const reply = [
        '查到了。火焰纹章系列最新作是《Fire Emblem: Fortune\'s Weave》。',
        '几个可参考的链接：',
        '- [3] 任天堂官网',
        '测试完毕，搜索功能正常。',
    ].join('\n')
    assert.equal(collapseRepeatedAssistantText(`${reply}\n\n${reply}`), reply)
})
