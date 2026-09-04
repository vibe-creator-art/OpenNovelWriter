import assert from 'node:assert/strict'
import test from 'node:test'

import { numberedActTitle, numberedChapterTitle } from './labels'

test('Chinese numbered headings join with a space and skip placeholders', () => {
    assert.equal(numberedActTitle('zh-CN', 1, '序章'), '第1卷 序章')
    assert.equal(numberedActTitle('zh-CN', 2, null), '第2卷')
    assert.equal(numberedActTitle('zh-CN', 2, '卷 2'), '第2卷')
    assert.equal(numberedChapterTitle('zh-CN', 1, '细雨中的仙霞派'), '第1章 细雨中的仙霞派')
    assert.equal(numberedChapterTitle('zh-CN', 1, '章 1'), '第1章')
    assert.equal(numberedChapterTitle('zh-CN', 1, '第1章 细雨中的仙霞派'), '第1章 细雨中的仙霞派')
})

test('English numbered headings join with a colon', () => {
    assert.equal(numberedActTitle('en', 1, 'The Void'), 'Act 1: The Void')
    assert.equal(numberedActTitle('en', 1, 'Act 1'), 'Act 1')
    assert.equal(numberedChapterTitle('en', 3, 'First Light'), 'Chapter 3: First Light')
    assert.equal(numberedChapterTitle('en', 3, 'Chapter 3'), 'Chapter 3')
})
