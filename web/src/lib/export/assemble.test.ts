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
        numberedHeadings: false,
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
        numberedHeadings: false,
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
        numberedHeadings: false,
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
        numberedHeadings: false,
        sceneDivider: 'none',
        language: 'zh-CN',
    }))

    assert.ok(text.startsWith('虚空之中'))
})

test('prefixes 第X卷 and 第X章 without duplicating placeholder titles', () => {
    const text = renderTxt(assembleManuscript(acts, chapters, ['c1', 'c3'], {
        includeActTitles: true,
        numberedHeadings: true,
        sceneDivider: 'none',
        language: 'zh-CN',
    }))

    assert.match(text, /第1卷 虚空之中/)
    assert.match(text, /第1章/)
    assert.match(text, /第2卷/)
    assert.match(text, /第3章/)
    assert.doesNotMatch(text, /第1章 章 1/)
    assert.doesNotMatch(text, /第3章 章 3/)
    assert.doesNotMatch(text, /第2卷 卷 2/)
})

test('keeps custom names after the numbered prefix', () => {
    const named: ExportChapter[] = [
        {
            id: 'n1',
            title: '细雨中的仙霞派',
            actNumber: 1,
            order: 1,
            scenes: [{ order: 0, content: '<p>开篇。</p>' }],
        },
        {
            id: 'n2',
            title: '藏经阁捉贼',
            actNumber: 2,
            order: 1,
            chapterNumber: 76,
            scenes: [{ order: 0, content: '<p>中段。</p>' }],
        },
    ]
    const text = renderTxt(assembleManuscript(
        [{ number: 1, title: '序章' }, { number: 2, title: '江湖初涉篇' }],
        named,
        ['n1', 'n2'],
        {
            includeActTitles: true,
            numberedHeadings: true,
            sceneDivider: 'none',
            language: 'zh-CN',
        },
    ))

    assert.match(text, /第1卷 序章/)
    assert.match(text, /第1章 细雨中的仙霞派/)
    assert.match(text, /第2卷 江湖初涉篇/)
    assert.match(text, /第76章 藏经阁捉贼/)
})

test('uses English numbered headings with a colon', () => {
    const text = renderTxt(assembleManuscript(
        [{ number: 1, title: 'The Void' }],
        [{
            id: 'e1',
            title: 'First Light',
            actNumber: 1,
            order: 1,
            scenes: [{ order: 0, content: '<p>Hello.</p>' }],
        }],
        ['e1'],
        {
            includeActTitles: true,
            numberedHeadings: true,
            sceneDivider: 'none',
            language: 'en',
        },
    ))

    assert.match(text, /Act 1: The Void/)
    assert.match(text, /Chapter 1: First Light/)
})
