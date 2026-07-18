/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict')
const test = require('node:test')

const {
    applyHunk,
    diffRegions,
    htmlToManuscriptMarkdown,
    manuscriptMarkdownToHtml,
} = require('./manuscript-edit.cjs')
const { buildNovelWorkspaceChapterMarkdown } = require('./novel-workspace-projection.cjs')

test('bold and italic round-trip between TipTap HTML and manuscript Markdown', () => {
    const html = [
        '<p>普通 <strong>粗体</strong> 和 <em>斜体</em>，以及 <strong><em>两者</em></strong>。</p>',
        '<p>字面量 *、_ 和 \\。</p>',
    ].join('')
    const markdown = [
        '普通 **粗体** 和 *斜体*，以及 ***两者***。',
        '',
        '字面量 \\*、\\_ 和 \\\\。',
    ].join('\n')

    assert.equal(htmlToManuscriptMarkdown(html), markdown)
    assert.equal(manuscriptMarkdownToHtml(markdown), html)
})

test('chapter workspace projection preserves manuscript emphasis', () => {
    const projection = buildNovelWorkspaceChapterMarkdown({
        id: 'chapter-1',
        title: '测试章',
        language: 'zh',
        scenes: [{
            id: 'scene-1',
            order: 0,
            summary: null,
            content: '<p>她说：<strong>必须</strong><em>马上</em>离开。</p>',
        }],
    })

    assert.match(projection, /她说：\*\*必须\*\*\*马上\*离开。/)
    assert.doesNotMatch(projection, /<(strong|em)>/)
})

test('editing text inside an emphasized span keeps the surrounding mark', () => {
    const result = applyHunk(
        '<p>她说：<em>现在就走</em>。</p>',
        '现在就走',
        '马上就走'
    )

    assert.equal(result.ok, true)
    assert.equal(result.newHtml, '<p>她说：<em>马上就走</em>。</p>')
})

test('Codex can add and remove the two supported marks', () => {
    const added = applyHunk('<p>这很重要。</p>', '很重要', '很**重要**')
    assert.equal(added.ok, true)
    assert.equal(added.newHtml, '<p>这很<strong>重要</strong>。</p>')

    const removed = applyHunk('<p>她说：<em>现在就走</em>。</p>', '*现在就走*', '现在就走')
    assert.equal(removed.ok, true)
    assert.equal(removed.newHtml, '<p>她说：现在就走。</p>')
})

test('format-only edits produce a review region', () => {
    const before = '<p>重要。</p>'
    const after = '<p><strong>重要</strong>。</p>'

    assert.equal(diffRegions(before, after).length, 1)
})

test('adjacent bold and italic spans remain distinct', () => {
    const markdown = '**粗体***斜体* / *斜体***粗体**'

    assert.equal(
        manuscriptMarkdownToHtml(markdown),
        '<p><strong>粗体</strong><em>斜体</em> / <em>斜体</em><strong>粗体</strong></p>'
    )
})

test('unbalanced Markdown markers stay literal', () => {
    assert.equal(manuscriptMarkdownToHtml('这不是 *完整格式'), '<p>这不是 *完整格式</p>')
})
