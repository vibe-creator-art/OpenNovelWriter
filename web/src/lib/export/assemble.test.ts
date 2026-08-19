import assert from 'node:assert/strict'
import test from 'node:test'

import { assembleManuscript } from './assemble'
import { renderTxt } from './render-txt'
import type { ExportAct, ExportChapter } from './types'

const acts: ExportAct[] = [
    { number: 1, title: '虚空之中' },
    { number: 2, title: null },
]

const chapters: ExportChapter[] = [
    {
        id: 'c1',
        title: '章 1',
        actNumber: 1,
        order: 1,
        scenes: [
            { order: 0, content: '<p>第一场。</p>' },
            { order: 1, content: '<p>第二场。</p><p>还有一段。</p>' },
        ],
    },
    {
        id: 'c2',
        title: '章 2',
        actNumber: 1,
        order: 2,
        scenes: [{ order: 0, content: '<p></p>' }],
    },
    {
        id: 'c3',
        title: '章 3',
        actNumber: 2,
        order: 1,
        scenes: [{ order: 0, content: '<p>下一卷。</p>' }],
    },
]

test('keeps empty chapter titles and skips empty scene bodies for asterisks', () => {
    const blocks = assembleManuscript(acts, chapters, ['c1', 'c2'], {
        includeActTitles: true,
        sceneDivider: 'asterisks',
        language: 'zh-CN',
    })
    const text = renderTxt(blocks)

    assert.match(text, /虚空之中/)
    assert.match(text, /章 1/)
    assert.match(text, /章 2/)
    assert.match(text, /\* \* \*/)
    assert.match(text, /第一场。/)
    assert.match(text, /第二场。/)
    assert.doesNotMatch(text, /卷 2/)
})

test('omits act titles when the switch is off', () => {
    const text = renderTxt(assembleManuscript(acts, chapters, ['c1', 'c3'], {
        includeActTitles: false,
        sceneDivider: 'none',
        language: 'zh-CN',
    }))

    assert.doesNotMatch(text, /虚空之中/)
    assert.doesNotMatch(text, /卷 2/)
    assert.match(text, /章 1/)
    assert.match(text, /章 3/)
})

test('uses localized scene headings and default act titles', () => {
    const text = renderTxt(assembleManuscript(acts, chapters, ['c3'], {
        includeActTitles: true,
        sceneDivider: 'headings',
        language: 'zh-CN',
    }))

    assert.match(text, /卷 2/)
    assert.match(text, /场 1/)
    assert.match(text, /下一卷。/)
})

test('does not put a book title or author at the start', () => {
    const text = renderTxt(assembleManuscript(acts, chapters, ['c1'], {
        includeActTitles: true,
        sceneDivider: 'none',
        language: 'zh-CN',
    }))

    assert.ok(text.startsWith('虚空之中'))
})
