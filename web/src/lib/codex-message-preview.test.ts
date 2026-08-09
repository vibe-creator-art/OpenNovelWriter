import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const {
    flattenCodexMessagePreview,
    getCodexSessionPreviewText,
    getCodexSessionPreviewTitle,
} = await import(new URL('./codex-message-preview.ts', import.meta.url).href)

describe('flattenCodexMessagePreview', () => {
    test('flattens Codex reference tokens to their visible labels', () => {
        assert.equal(
            flattenCodexMessagePreview(
                '帮我把 [第 144 章 相遇](chapter:cmqwng5xq001xbl970kskujnn) 标题改为相知'
            ),
            '帮我把 第 144 章 相遇 标题改为相知'
        )
    })

    test('flattens references in assistant replies and normalizes whitespace', () => {
        assert.equal(
            flattenCodexMessagePreview(
                '已完成 ✅\n[第 144 章 相遇](chapter:cmqwng5xq001xbl970kskujnn) 的标题已修改。'
            ),
            '已完成 ✅ 第 144 章 相遇 的标题已修改。'
        )
    })

    test('keeps ordinary plain text unchanged', () => {
        assert.equal(flattenCodexMessagePreview('你能看到什么工具'), '你能看到什么工具')
    })

    test('builds an automatic title from the complete user message instead of a truncated stored token', () => {
        assert.equal(
            getCodexSessionPreviewTitle({
                title: '帮我把 [第 144 章 相遇](chapter:cmq...',
                titleManuallyEdited: false,
                messages: [{
                    id: 'user-1',
                    role: 'user',
                    content: '帮我把 [第 144 章 相遇](chapter:cmqwng5xq001xbl970kskujnn) 标题改为相知',
                    createdAt: '2026-08-09T08:00:00.000Z',
                }],
            }, 'Codex session'),
            '帮我把 第 144 章 相遇 标题改为相知'
        )
    })

    test('flattens the latest message used by session lists', () => {
        assert.equal(
            getCodexSessionPreviewText({
                draftContent: '',
                messages: [{
                    id: 'assistant-1',
                    role: 'assistant',
                    content: '已完成 [第 144 章 相遇](chapter:chapter-1) 的修改。',
                    createdAt: '2026-08-09T08:00:01.000Z',
                }],
            }, 'No messages'),
            '已完成 第 144 章 相遇 的修改。'
        )
    })
})
