import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collectWebReferences, markdownToHtml } from './simple-markdown'

test('renders a titled web link as text plus a citation mark', () => {
    const html = markdownToHtml('见[任天堂官网](https://www.nintendo.com/hk/news)')
    assert.match(html, /见任天堂官网<sup>/)
    assert.match(html, />\[1\]<\/a><\/sup>/)
    assert.match(html, /参考链接/)
    assert.match(html, />\[1\] <a href="https:\/\/www.nintendo.com\/hk\/news"/)
    assert.match(html, />任天堂官网<\/a>/)
})

test('renders numbered citations as superscripts and lists them at the bottom', () => {
    const html = markdownToHtml('正式公布。[[1]](https://www.nintendo.com/hk/topics/article/abc?srsltid=longtoken)')
    assert.match(html, /正式公布。<sup>/)
    assert.match(html, />\[1\]<\/a><\/sup>/)
    assert.equal(html.includes('[[1]]'), false)
    assert.match(html, /<li id="onw-ref-1">\[1\] <a href="https:\/\/www.nintendo.com\/hk\/topics\/article\/abc\?srsltid=longtoken"/)
})

test('maps bare [1] [2] marks onto later titled links', () => {
    const html = markdownToHtml('Direct 公布。[1]\n\n补充说明。[2]\n\n- [任天堂香港](https://www.nintendo.com/hk/news)\n- [巴哈姆特](https://gnn.gamer.com.tw/detail.php?sn=306391)')
    assert.match(html, /公布。<sup>/)
    assert.match(html, /说明。<sup>/)
    assert.match(html, /<li id="onw-ref-1">\[1\] <a href="https:\/\/www.nintendo.com\/hk\/news"/)
    assert.match(html, /<li id="onw-ref-2">\[2\] <a href="https:\/\/gnn.gamer.com.tw\/detail.php\?sn=306391"/)
})

test('collects numbered and titled links without duplicating the same URL', () => {
    const refs = collectWebReferences('公布。[[1]](https://example.com/a) 另见[官网](https://example.com/a)')
    assert.equal(refs.length, 1)
    assert.equal(refs[0]?.number, '1')
    assert.equal(refs[0]?.href, 'https://example.com/a')
    assert.equal(refs[0]?.title, '官网')
})

test('does not autolink URLs inside inline code', () => {
    const html = markdownToHtml('用 `https://example.com/path` 即可')
    assert.match(html, /<code>https:\/\/example.com\/path<\/code>/)
    assert.equal(html.includes('参考链接'), false)
})

test('dedupes numbered citations when the reply body is repeated', () => {
    const reply = [
        '查到了。火焰纹章系列最新作是《Fire Emblem: Fortune\'s Weave》，将于 2026 年 9 月 17 日发售。[[3]](https://www.nintendo.com/tw/topics/article/6Tmi)[[4]](https://www.nintendo.com/ph/news/article/4KShZr)',
        '',
        '几个可参考的链接：',
        '- [3] 任天堂官网（繁中）',
        '- [4] 任天堂新闻（菲律宾）',
        '- [5] IGN',
        '',
        '测试完毕，搜索功能正常。',
    ].join('\n')
    const refs = collectWebReferences(`${reply}\n\n${reply}\n\n[[5]](https://www.ign.com/articles/nintendo-confirms-fire-emblem)`)
    assert.deepEqual(refs.map((ref) => ref.number), ['3', '4', '5'])
    assert.equal(new Set(refs.map((ref) => ref.number)).size, refs.length)
})
