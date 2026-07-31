import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { stripUserMessageTokens } from './right-panel-codex'

describe('stripUserMessageTokens', () => {
    test('copies every composer pill with its canonical trigger', () => {
        const content = [
            '[模型](model:model-1)',
            '[技能](skill:skill-1)',
            '[术语](term:term-1)',
            '[片段](snippet:snippet-1)',
            '[资料](material:material-1)',
            '[章纲](outlineChapter:chapter-1)',
            '[卷纲](outlineAct:1)',
            '[第一章](chapter:chapter-1)',
            '[第一卷](act:1)',
        ].join(' ')

        assert.equal(
            stripUserMessageTokens(content),
            '@模型 /技能 @术语 @片段 @资料 @章纲 @卷纲 @第一章 @第一卷'
        )
    })

    test('keeps navigation links and malformed tokens as plain text', () => {
        const content = [
            '[场景](scene:scene-1)',
            '[续写](continuation:chapter-1:scene-1:panel-1)',
            '[未知](unknown:value)',
        ].join('\n')

        assert.equal(
            stripUserMessageTokens(content),
            ['场景', '续写', '[未知](unknown:value)'].join('\n')
        )
    })
})
