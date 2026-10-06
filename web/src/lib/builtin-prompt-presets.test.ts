import assert from 'node:assert/strict'
import { test } from 'node:test'

import continuationAsset from '@/presets/assets/preset-50l0ku.json'
import chatAsset from '@/presets/assets/preset-1rdyzld.json'
import summaryAsset from '@/presets/assets/preset-1wn6l8l.json'
import { buildTermMentionMatcher, findMentionedTermIds } from '@/components/editor/terms/term-mentions-utils'
import type { TermEntry } from '@/components/editor/terms/types'
import { getContentSelectionTemplateItems, type ContentSelectionTemplateResources } from './content-selection-template'
import { parsePromptPresetAsset, type PromptPresetAssetV1 } from './prompt-preset'
import type { ContentSelectionTarget } from './prompt-inputs'
import { renderPromptTemplateMessages, type PromptTemplateRenderContext, type PromptTemplateRenderResolvers } from './prompt-template-render'
import { analyzeChatPromptMessages } from './prompt-template'
import { renderTermTemplateText, renderTermTemplateValue, resolveTrackedTermIds } from './term-template'

const terms: TermEntry[] = [
    { id: 'local-act', categoryId: 'characters', title: '青灯', description: 'KNOWLEDGE_LOCAL_ACT' },
    { id: 'local-chapter', categoryId: 'characters', title: '陆昭', aliases: '陆公子', description: 'KNOWLEDGE_LOCAL_CHAPTER' },
    { id: 'selected-act', categoryId: 'locations', title: '雁回城', description: 'KNOWLEDGE_SELECTED_ACT' },
    { id: 'selected-chapter', categoryId: 'items', title: '明月剑', description: 'KNOWLEDGE_SELECTED_CHAPTER' },
    { id: 'never', categoryId: 'characters', title: '隐者', description: 'KNOWLEDGE_NEVER', aiContextPolicy: 'never' },
    { id: 'archived', categoryId: 'characters', title: '旧王', description: 'KNOWLEDGE_ARCHIVED', archived: true },
    { id: 'unrelated', categoryId: 'characters', title: '路人', description: 'KNOWLEDGE_UNRELATED' },
]
const termsById = new Map(terms.map((term) => [term.id, term]))
const matcher = buildTermMentionMatcher(terms)

function resources(): ContentSelectionTemplateResources {
    const scenes = [
        { id: 'scene-1', order: 0, content: '<p>SELECTED_PROSE</p>', summary: 'SELECTED_SCENE_SUMMARY', labelIds: ['focus'] },
        { id: 'scene-2', order: 1, content: '<p>OTHER_PROSE</p>', summary: 'OTHER_SCENE_SUMMARY', labelIds: [] },
    ]
    const chapters = [{ id: 'chapter-1', title: '第一章', order: 0, actNumber: 1, scenes }]
    return {
        acts: [{ number: 1, title: '第一卷', summary: 'SELECTED_ACT_SUMMARY', labelIds: ['focus'] }],
        chapters,
        chaptersById: new Map(chapters.map((chapter) => [chapter.id, chapter])),
        scenesById: new Map(scenes.map((scene) => [scene.id, scene])),
        novelOutlineFull: 'SELECTED_NOVEL_SUMMARY',
        outlineTextByActNumber: new Map([[1, '众人抵达雁回城，隐者与旧王离开。']]),
        outlineTextByChapterId: new Map([['chapter-1', '众人找到了明月剑。']]),
    }
}

function renderPreset(preset: PromptPresetAssetV1, selections: ContentSelectionTarget[], context: PromptTemplateRenderContext = {}, manualTermIds: string[] = [], overrides: Partial<PromptTemplateRenderResolvers> = {}) {
    const entry = preset.bundle.prompts[0]
    const input = entry.inputs.find((input) => input.name === '额外信息')
    assert.ok(input?.type === 'content_selection')
    const content = resources()
    const selectedItems = (kind: Parameters<typeof getContentSelectionTemplateItems>[0]['kind']) =>
        getContentSelectionTemplateItems({ kind, input, selections, resources: content, locale: 'zh-CN' })

    return renderPromptTemplateMessages({
        texts: entry.messages.map((message) => message.content),
        context: { novelLanguage: 'zh-CN', instructionText: '继续写作。', chatUserInput: '分析这段剧情。', ...context },
        resolvers: {
            resolveInput: (name) => name === '目标字数' ? '2000' : name === '启用planning' ? '启用planning' : '',
            resolveInclude: (name) => preset.bundle.prompts.find((prompt) => prompt.name === name)?.messages[0]?.content,
            resolveInputFullNovels: () => selectedItems('fullNovel'),
            resolveInputActs: () => selectedItems('act'),
            resolveInputChapters: () => selectedItems('chapter'),
            resolveInputScenes: () => selectedItems('scene'),
            resolveInputActOutlines: () => selectedItems('actOutline'),
            resolveInputChapterOutlines: () => selectedItems('chapterOutline'),
            resolveInputTermIds: () => manualTermIds,
            resolveInputTermTagTermIds: () => manualTermIds,
            resolveTextTermIds: (text) => resolveTrackedTermIds({ mentionedTermIds: findMentionedTermIds(text, matcher), termsById }),
            resolveTermText: (id) => renderTermTemplateText(termsById.get(id) ?? null),
            resolveTermValue: (id) => renderTermTemplateValue({ entry: termsById.get(id) ?? null, termsById, includeRelations: false, includeExperiences: false }),
            ...overrides,
        },
    })
}

for (const asset of [continuationAsset, chatAsset]) {
    const parsed = parsePromptPresetAsset(asset)
    assert.ok(parsed.ok, parsed.ok ? undefined : parsed.detail)
    const preset = parsed.preset
    const entry = preset.bundle.prompts[0]

    test(`${entry.name}: the cloneable bundle includes AdditionalInfo and preserves the chat input contract`, () => {
        assert.equal(preset.metadata.revision, 2.0)
        assert.ok(preset.bundle.prompts.some((prompt) => prompt.name === 'AdditionalInfo' && prompt.category === 'component'))
        const input = entry.inputs.find((input) => input.type === 'content_selection')
        assert.ok(input?.type === 'content_selection' && input.contentSelection.options.label.enabled)
        if (entry.category === 'ai_chat') assert.equal(analyzeChatPromptMessages(entry.messages).valid, true)
        const rendered = renderPreset(preset, [])
        assert.deepEqual(rendered.warnings, [])
        assert.doesNotMatch(rendered.texts.join('\n'), /<AdditionalInfo>/)
    })

    const cases: Array<{ selection: ContentSelectionTarget; expected: string[] }> = [
        { selection: { kind: 'full_novel' }, expected: ['SELECTED_NOVEL_SUMMARY'] },
        { selection: { kind: 'act', actNumber: 1 }, expected: ['SELECTED_ACT_SUMMARY'] },
        { selection: { kind: 'chapter', chapterId: 'chapter-1' }, expected: ['SELECTED_PROSE', 'OTHER_PROSE'] },
        { selection: { kind: 'scene', sceneId: 'scene-1' }, expected: ['SELECTED_PROSE'] },
        { selection: { kind: 'label', labelId: 'focus' }, expected: ['SELECTED_ACT_SUMMARY', 'SELECTED_PROSE'] },
    ]
    for (const { selection, expected } of cases) {
        test(`${entry.name}: ${selection.kind} reaches the final AdditionalInfo block`, () => {
            const rendered = renderPreset(preset, [selection])
            assert.deepEqual(rendered.warnings, [])
            const additional = rendered.texts.join('\n').match(/<AdditionalInfo>([\s\S]*?)<\/AdditionalInfo>/)?.[1]
            assert.ok(additional)
            assert.match(additional, /重点关注/)
            for (const marker of expected) assert.ok(additional.includes(marker), marker)
            assert.doesNotMatch(additional, /KNOWLEDGE_|<p>|<SnippetInfo>/)
        })
    }

    test(`${entry.name}: explicitly supplied outlines add knowledge using titles and aliases`, () => {
        const rendered = renderPreset(preset, [
            { kind: 'act_outline', actNumber: 1 },
            { kind: 'chapter_outline', chapterId: 'chapter-1' },
        ], {
            sceneActOutline: '青灯将出发。',
            sceneChapterOutline: '陆公子准备远行。',
        })

        assert.deepEqual(rendered.warnings, [])
        const knowledge = rendered.texts.at(-1)?.match(/<TermKnowledge>\s*([\s\S]*?)<\/TermKnowledge>/)?.[1]
        assert.ok(knowledge)
        const expected = entry.category === 'ai_chat'
            ? ['KNOWLEDGE_SELECTED_ACT', 'KNOWLEDGE_SELECTED_CHAPTER']
            : ['KNOWLEDGE_LOCAL_ACT', 'KNOWLEDGE_LOCAL_CHAPTER', 'KNOWLEDGE_SELECTED_ACT', 'KNOWLEDGE_SELECTED_CHAPTER']
        for (const marker of expected) {
            assert.equal(knowledge.split(marker).length - 1, 1, marker)
        }
        if (entry.category === 'ai_chat') assert.doesNotMatch(knowledge, /KNOWLEDGE_LOCAL_ACT|KNOWLEDGE_LOCAL_CHAPTER/)
        assert.doesNotMatch(knowledge, /KNOWLEDGE_NEVER|KNOWLEDGE_ARCHIVED|KNOWLEDGE_UNRELATED/)
    })

    test(`${entry.name}: outline knowledge is deduplicated against instructions, chat and manual terms`, () => {
        const rendered = renderPreset(preset, [
            { kind: 'act_outline', actNumber: 1 },
            { kind: 'chapter_outline', chapterId: 'chapter-1' },
        ], {
            sceneActOutline: '青灯抵达雁回城。',
            sceneChapterOutline: '陆公子拿起明月剑。',
            instructionTerms: ['local-act', 'selected-act'],
            chatUserInputTerms: ['local-act'],
            chatHistoryTerms: ['selected-act'],
        }, ['local-chapter', 'selected-chapter'])
        assert.deepEqual(rendered.warnings, [])
        const knowledge = rendered.texts.at(-1)?.match(/<TermKnowledge>\s*([\s\S]*?)<\/TermKnowledge>/)?.[1]
        assert.ok(knowledge)
        for (const marker of ['KNOWLEDGE_LOCAL_ACT', 'KNOWLEDGE_LOCAL_CHAPTER', 'KNOWLEDGE_SELECTED_ACT', 'KNOWLEDGE_SELECTED_CHAPTER']) {
            assert.equal(knowledge.split(marker).length - 1, 1, marker)
        }
    })

    test(`${entry.name}: unselected outlines and ordinary summaries do not add detected outline terms`, () => {
        const rendered = renderPreset(preset, [], { novelOutlineFull: '路人遇到青灯。', novelOutlineStorySoFar: '路人遇到陆公子。' })
        assert.deepEqual(rendered.warnings, [])
        const knowledge = rendered.texts.at(-1)?.match(/<TermKnowledge>\s*([\s\S]*?)<\/TermKnowledge>/)?.[1] ?? ''
        assert.doesNotMatch(knowledge, /KNOWLEDGE_LOCAL_ACT|KNOWLEDGE_LOCAL_CHAPTER|KNOWLEDGE_SELECTED_CHAPTER|KNOWLEDGE_UNRELATED/)
    })

    test(`${entry.name}: empty optional components render nothing, including whitespace`, () => {
        const names = entry.category === 'ai_chat'
            ? ['TermKnowledgeChat', 'SnippetInfo', 'AdditionalInfo', 'OutlineFull', 'DetailedOutlineChat']
            : ['TermKnowledge', 'SnippetInfo', 'AdditionalInfo', 'Outline', 'DetailedOutline']
        for (const name of names) {
            const withComponentOnly = structuredClone(preset)
            withComponentOnly.bundle.prompts[0].messages = [{
                ...entry.messages[0], content: `{% include "${name}" %}`,
            }]
            const rendered = renderPreset(withComponentOnly, [])
            assert.deepEqual(rendered.warnings, [])
            assert.equal(rendered.texts[0], '', name)
        }
        const rendered = renderPreset(preset, [])
        assert.deepEqual(rendered.warnings, [])
        for (const text of rendered.texts) assert.doesNotMatch(text.trim(), /\n[\t ]*\n[\t ]*\n/)
    })

    test(`${entry.name}: populated components stay separated and preserve supplied paragraphs`, () => {
        const paragraphs = '第一段。\n\n\n    第二段缩进。\n\n```text\n  示例\n\n\n```'
        const rendered = renderPreset(preset, [{ kind: 'chapter', chapterId: 'chapter-1' }], {
            novelOutlineStorySoFar: paragraphs,
            novelOutlineFull: paragraphs,
            sceneActOutline: paragraphs,
            sceneChapterOutline: paragraphs,
            sceneContinueHasPreviousText: true,
            sceneContinuePreviousText: paragraphs,
            sceneContinueHasFollowText: true,
            sceneContinueFollowText: paragraphs,
            instructionText: paragraphs,
            chatUserInput: paragraphs,
        }, ['local-act'], {
            resolveInputSnippets: () => [{ value: paragraphs }],
            resolveInputChapters: () => [{ value: paragraphs }],
            resolveInputActOutlines: () => [{ value: paragraphs }],
            resolveInputChapterOutlines: () => [{ value: paragraphs }],
        })
        assert.deepEqual(rendered.warnings, [])
        const user = rendered.texts[1]
        const blocks = ['TermKnowledge', 'SnippetInfo', 'AdditionalInfo', 'Outline', 'DetailedOutline']
        if (entry.category === 'scene_continuation') blocks.push('PreviousText', 'FollowingText', 'Instruction')
        for (let i = 1; i < blocks.length; i += 1) {
            assert.ok(user.includes(`</${blocks[i - 1]}>\n\n<${blocks[i]}>`), `${blocks[i - 1]} -> ${blocks[i]}`)
        }
        for (const tag of ['SnippetInfo', 'Outline', 'ActOutline', 'ChapterOutline']) {
            assert.ok(user.includes(`<${tag}>\n${paragraphs}\n</${tag}>`), tag)
        }
        assert.ok(user.includes(`\n\n${paragraphs}\n</AdditionalInfo>`))
        if (entry.category === 'scene_continuation') {
            for (const tag of ['PreviousText', 'FollowingText', 'Instruction']) {
                assert.ok(user.includes(`<${tag}>\n${paragraphs}\n</${tag}>`), tag)
            }
            assert.match(rendered.texts[0], /<\/ResponseGuidance>\n\n<WritingStyle>\n<CommonAIMistakes>/)
        } else {
            assert.ok(user.endsWith(`：\n${paragraphs}`))
        }
    })

    test(`${entry.name}: gaps left by empty components do not accumulate between populated blocks`, () => {
        const rendered = renderPreset(preset, [], { novelOutlineFull: '故事摘要', novelOutlineStorySoFar: '故事摘要' }, ['local-act'])
        assert.deepEqual(rendered.warnings, [])
        assert.match(rendered.texts[1], /<\/TermKnowledge>\n\n<Outline>\n故事摘要\n<\/Outline>/)
        assert.doesNotMatch(rendered.texts[1].trim(), /\n[\t ]*\n[\t ]*\n/)
    })
}

test('scene summary preset separates its source block without changing manuscript whitespace', () => {
    const parsed = parsePromptPresetAsset(summaryAsset)
    assert.ok(parsed.ok, parsed.ok ? undefined : parsed.detail)
    assert.equal(parsed.preset.metadata.revision, 1.6)
    const entry = parsed.preset.bundle.prompts[0]
    for (const sceneText of ['', '第一段。\n\n\n    第二段。\n\n```text\n  示例\n\n\n```']) {
        const rendered = renderPromptTemplateMessages({
            texts: entry.messages.map((message) => message.content),
            context: { novelLanguage: 'zh-CN', sceneText },
            resolvers: { resolveInput: () => '200', resolveInclude: () => null },
        })
        assert.deepEqual(rendered.warnings, [])
        assert.equal(rendered.texts[1], `对如下文本进行总结：\n\n<scene>\n${sceneText}\n</scene>`)
        assert.doesNotMatch(rendered.texts[0], /\n[\t ]*\n[\t ]*\n/)
    }
})
