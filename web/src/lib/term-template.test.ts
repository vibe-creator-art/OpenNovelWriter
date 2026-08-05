import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { TermEntry } from '@/components/editor/terms/types'
import { renderTermTemplateValue } from './term-template'

const protagonist: TermEntry = {
    id: 'term-protagonist',
    categoryId: 'characters',
    title: '楚天歌',
    description: '白帝楼楼主。',
    experiences: '十八岁创立白帝楼\n在雪原救下林晚秋',
    researchNotes: '称号为白帝。',
    relations: [
        { id: 'relation-mentor', otherId: 'term-student', direction: 'outgoing', label: '师徒' },
        { id: 'relation-rival', otherId: 'term-rival', direction: 'bidirectional', label: '敌对' },
    ],
}

const termsById = new Map<string, TermEntry>([
    [protagonist.id, protagonist],
    ['term-student', { id: 'term-student', categoryId: 'characters', title: '林晚秋' }],
    ['term-rival', { id: 'term-rival', categoryId: 'characters', title: '魔尊' }],
])

describe('renderTermTemplateValue', () => {
    test('renders relation titles and experiences in the complete term block', () => {
        assert.equal(
            renderTermTemplateValue({
                entry: protagonist,
                termsById,
                includeRelations: true,
                includeExperiences: true,
                locale: 'zh-CN',
            }),
            [
                '<角色，name=楚天歌>',
                '白帝楼楼主。',
                '关系：',
                '- 指向 林晚秋（师徒）',
                '- 双向 魔尊（敌对）',
                '经历：',
                '- 十八岁创立白帝楼',
                '- 在雪原救下林晚秋',
                '称号为白帝。',
                '</角色>',
            ].join('\n')
        )
    })

    test('omits disabled relation and experience sections independently', () => {
        const withoutRelations = renderTermTemplateValue({
            entry: protagonist,
            termsById,
            includeRelations: false,
            includeExperiences: true,
            locale: 'zh-CN',
        })
        assert.doesNotMatch(withoutRelations, /关系：/)
        assert.match(withoutRelations, /经历：/)

        const withoutExperiences = renderTermTemplateValue({
            entry: protagonist,
            termsById,
            includeRelations: true,
            includeExperiences: false,
            locale: 'zh-CN',
        })
        assert.match(withoutExperiences, /关系：/)
        assert.doesNotMatch(withoutExperiences, /经历：/)
    })
})
