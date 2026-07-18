/* eslint-disable @typescript-eslint/no-require-imports */
// Block-level search/replace for manuscript (scene) HTML.
//
// Scene content is stored as TipTap HTML (a flat sequence of block elements such
// as <p>, <h2>, <blockquote>). Codex reads a Markdown projection that preserves
// bold and italic marks, then proposes { old_text -> new_text } search/replace
// hunks against it. This module performs the matching and the limited
// HTML/Markdown round trip while leaving untouched blocks byte-identical.

const crypto = require('crypto')

const BLOCK_RE = /<(p|h[1-6]|blockquote|pre|ul|ol|figure|table)\b[^>]*>[\s\S]*?<\/\1>|<hr\s*\/?>/gi

function decodeEntities(value) {
    return String(value)
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&amp;/g, '&')
        .replace(/ /g, ' ')
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function escapeMarkdownText(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/\*/g, '\\*')
        .replace(/_/g, '\\_')
}

// Split scene HTML into an ordered list of top-level block strings. Whitespace-only
// gaps between blocks are dropped, so blocks.join('') reproduces clean TipTap output.
function splitBlocks(html) {
    const src = String(html ?? '')
    const blocks = []
    let lastIndex = 0
    let match

    BLOCK_RE.lastIndex = 0
    while ((match = BLOCK_RE.exec(src)) !== null) {
        if (match.index > lastIndex) {
            const gap = src.slice(lastIndex, match.index)
            if (gap.trim()) blocks.push(gap)
        }
        blocks.push(match[0])
        lastIndex = match.index + match[0].length
    }
    if (lastIndex < src.length) {
        const tail = src.slice(lastIndex)
        if (tail.trim()) blocks.push(tail)
    }
    if (blocks.length === 0 && src.trim()) blocks.push(src)
    return blocks
}

// Plain text of a single block, matching how the workspace projection degrades HTML.
function blockText(blockHtml) {
    const stripped = String(blockHtml)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|h[1-6]|blockquote|pre)\s*>/gi, '\n')
        .replace(/<\/(li|tr)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    return decodeEntities(stripped)
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim()
}

// Markdown for a single block. Only bold and italic are projected as formatting;
// every other inline tag is intentionally flattened to its text content.
function blockMarkdown(blockHtml) {
    const tokens = String(blockHtml).match(/<[^>]+>|[^<]+/g) ?? []
    let markdown = ''

    for (const token of tokens) {
        if (!token.startsWith('<')) {
            markdown += escapeMarkdownText(decodeEntities(token))
            continue
        }

        const tagMatch = token.match(/^<\s*(\/?)\s*([a-z0-9-]+)/i)
        if (!tagMatch) continue
        const closing = tagMatch[1] === '/'
        const tag = tagMatch[2].toLowerCase()

        if (tag === 'br') {
            markdown += '\n'
        } else if (tag === 'strong' || tag === 'b') {
            markdown += '**'
        } else if (tag === 'em' || tag === 'i') {
            markdown += '*'
        } else if (closing && /^(p|h[1-6]|blockquote|pre|li|tr)$/.test(tag)) {
            markdown += '\n'
        }
    }

    return markdown
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\t+\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim()
}

// Build the projection text plus, for each block, the [start, end) range it occupies.
function buildProjection(blocks) {
    let text = ''
    const ranges = []
    blocks.forEach((block, index) => {
        const value = blockText(block)
        const separator = text ? '\n\n' : ''
        const start = text.length + separator.length
        text += separator + value
        ranges.push({ blockIndex: index, start, end: text.length })
    })
    return { text, ranges }
}

function buildMarkdownProjection(blocks) {
    let text = ''
    const ranges = []
    blocks.forEach((block, index) => {
        const value = blockMarkdown(block)
        const separator = text && value ? '\n\n' : ''
        const start = text.length + separator.length
        text += separator + value
        ranges.push({ blockIndex: index, start, end: text.length })
    })
    return { text, ranges }
}

function htmlToText(html) {
    return buildProjection(splitBlocks(html)).text
}

function htmlToManuscriptMarkdown(html) {
    return buildMarkdownProjection(splitBlocks(html)).text
}

// A regex that matches old_text with flexible whitespace (Codex may copy it with
// different spacing/newlines than the projection produced).
function buildFlexibleMatcher(oldText, flags) {
    const escaped = oldText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = escaped.replace(/\s+/g, '\\s+')
    return new RegExp(pattern, flags)
}

function tokenizeInlineMarkdown(value) {
    const tokens = []
    let text = ''
    const flushText = () => {
        if (!text) return
        tokens.push({ type: 'text', value: text })
        text = ''
    }

    for (let index = 0; index < value.length;) {
        const char = value[index]
        if (char === '\\' && index + 1 < value.length) {
            text += value[index + 1]
            index += 2
            continue
        }
        if (char === '\n') {
            flushText()
            tokens.push({ type: 'break' })
            index += 1
            continue
        }
        if (char === '*') {
            let end = index + 1
            while (end < value.length && value[end] === '*') end += 1
            const length = end - index
            if (length <= 3) {
                flushText()
                tokens.push({ type: 'marker', length })
            } else {
                text += '*'.repeat(length)
            }
            index = end
            continue
        }
        text += char
        index += 1
    }
    flushText()
    return tokens
}

function markerStateAfter(tokens) {
    let bold = false
    let italic = false
    for (const token of tokens) {
        if (token.type !== 'marker') continue
        if (token.length === 1) {
            italic = !italic
        } else if (token.length === 2) {
            bold = !bold
        } else if (bold && italic) {
            bold = false
            italic = false
        } else if (bold) {
            bold = false
            italic = true
        } else if (italic) {
            italic = false
            bold = true
        } else {
            bold = true
            italic = true
        }
    }
    return { bold, italic }
}

function inlineMarkdownToHtml(value) {
    const tokens = tokenizeInlineMarkdown(String(value))
    const finalState = markerStateAfter(tokens)
    const hasBalancedMarks = !finalState.bold && !finalState.italic
    if (!hasBalancedMarks) {
        return tokens.map((token) => {
            if (token.type === 'break') return '<br>'
            if (token.type === 'marker') return '*'.repeat(token.length)
            return escapeHtml(token.value)
        }).join('')
    }

    let html = ''
    const stack = []
    const tagByMark = { bold: 'strong', italic: 'em' }
    const toggleMark = (mark) => {
        const openIndex = stack.lastIndexOf(mark)
        if (openIndex < 0) {
            html += `<${tagByMark[mark]}>`
            stack.push(mark)
            return
        }

        const temporarilyClosed = stack.splice(openIndex + 1)
        for (let index = temporarilyClosed.length - 1; index >= 0; index -= 1) {
            html += `</${tagByMark[temporarilyClosed[index]]}>`
        }
        html += `</${tagByMark[mark]}>`
        stack.pop()
        for (const nestedMark of temporarilyClosed) {
            html += `<${tagByMark[nestedMark]}>`
            stack.push(nestedMark)
        }
    }

    for (const token of tokens) {
        if (token.type === 'text') {
            html += escapeHtml(token.value)
        } else if (token.type === 'break') {
            html += '<br>'
        } else if (token.length === 1) {
            toggleMark('italic')
        } else if (token.length === 2) {
            toggleMark('bold')
        } else {
            const hasBold = stack.includes('bold')
            const hasItalic = stack.includes('italic')
            if (hasBold && hasItalic) {
                toggleMark('italic')
                toggleMark('bold')
            } else if (hasBold) {
                toggleMark('bold')
                toggleMark('italic')
            } else if (hasItalic) {
                toggleMark('italic')
                toggleMark('bold')
            } else {
                toggleMark('bold')
                toggleMark('italic')
            }
        }
    }
    return html
}

function manuscriptMarkdownToHtml(markdown) {
    return String(markdown)
        .replace(/\r\n?/g, '\n')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0)
        .map((paragraph) => `<p>${inlineMarkdownToHtml(paragraph)}</p>`)
        .join('')
}

function anchorHashOf(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}

// Apply one { oldText -> newText } hunk to scene HTML.
// Returns { ok: true, newHtml, beforeHtml, afterHtml, beforeText, afterText, anchorHash }
// or { ok: false, error }.
function applyHunk(html, oldText, newText) {
    const rawOld = typeof oldText === 'string' ? oldText.trim() : ''
    const rawNew = typeof newText === 'string' ? newText : ''

    // Empty old_text = append new_text as new paragraph(s) at the end of the scene.
    // This is also the only way to write into an empty scene (there is no anchor to match).
    if (!rawOld) {
        const appended = manuscriptMarkdownToHtml(rawNew)
        if (!appended) {
            return { ok: false, error: 'old_text 与 new_text 不能同时为空。' }
        }
        const base = String(html ?? '')
        const newHtml = base + appended
        return {
            ok: true,
            newHtml,
            beforeHtml: '',
            afterHtml: appended,
            beforeText: '',
            afterText: htmlToText(appended),
            anchorHash: anchorHashOf(appended),
        }
    }

    const blocks = splitBlocks(html)
    const projection = buildMarkdownProjection(blocks)

    let matcher
    try {
        matcher = buildFlexibleMatcher(rawOld, 'g')
    } catch {
        return { ok: false, error: '无法解析 old_text。' }
    }

    const matches = [...projection.text.matchAll(matcher)]
    if (matches.length === 0) {
        return { ok: false, error: '在该场景里找不到 old_text（可能已被改动，或空白/标点不一致）。' }
    }
    if (matches.length > 1) {
        return { ok: false, error: 'old_text 在该场景里出现多次，请补充上下文让它唯一。' }
    }

    const match = matches[0]
    const matchStart = match.index
    const matchEnd = matchStart + match[0].length

    const covered = projection.ranges.filter((range) => range.start < matchEnd && range.end > matchStart)
    if (covered.length === 0) {
        return { ok: false, error: '无法定位 old_text 对应的段落。' }
    }
    const firstBlock = covered[0].blockIndex
    const lastBlock = covered[covered.length - 1].blockIndex

    const sourceText = blocks.slice(firstBlock, lastBlock + 1).map(blockMarkdown).filter(Boolean).join('\n\n')
    const replacedText = sourceText.replace(buildFlexibleMatcher(rawOld), () => rawNew.trim())

    const beforeHtml = blocks.slice(firstBlock, lastBlock + 1).join('')
    const afterHtml = manuscriptMarkdownToHtml(replacedText)

    const newHtml = [
        ...blocks.slice(0, firstBlock),
        ...(afterHtml ? [afterHtml] : []),
        ...blocks.slice(lastBlock + 1),
    ].join('')

    return {
        ok: true,
        newHtml,
        beforeHtml,
        afterHtml,
        // Report the texts exactly as stored (derived from the HTML), so what Codex sees
        // back matches the saved content and it doesn't try to "fix" phantom whitespace.
        beforeText: htmlToText(beforeHtml),
        afterText: htmlToText(afterHtml),
        anchorHash: anchorHashOf(afterHtml || beforeHtml),
    }
}

// LCS-based block diff: which original blocks were deleted, which final blocks inserted.
function diffBlockOps(aKeys, bKeys) {
    const n = aKeys.length
    const m = bKeys.length
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            dp[i][j] = aKeys[i] === bKeys[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1])
        }
    }

    const ops = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
        if (aKeys[i] === bKeys[j]) {
            ops.push({ type: 'equal', b: j })
            i += 1
            j += 1
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            ops.push({ type: 'delete', a: i })
            i += 1
        } else {
            ops.push({ type: 'insert', b: j })
            j += 1
        }
    }
    while (i < n) { ops.push({ type: 'delete', a: i }); i += 1 }
    while (j < m) { ops.push({ type: 'insert', b: j }); j += 1 }
    return ops
}

// Diff original vs final scene HTML and coalesce contiguous changed blocks into regions.
// Adjacent changes (no unchanged paragraph between) merge into one region; changes split
// by an unchanged paragraph become separate regions — clean, reviewable diff hunks.
function diffRegions(originalHtml, finalHtml) {
    const origBlocks = splitBlocks(originalHtml)
    const finalBlocks = splitBlocks(finalHtml)
    const ops = diffBlockOps(origBlocks.map(blockMarkdown), finalBlocks.map(blockMarkdown))

    const regions = []
    let current = null
    for (const op of ops) {
        if (op.type === 'equal') {
            if (current) {
                // The unchanged block that closed the region is its position anchor.
                current.afterAnchorHtml = finalBlocks[op.b] ?? ''
                regions.push(current)
                current = null
            }
            continue
        }
        if (!current) current = { del: [], ins: [], afterAnchorHtml: '' }
        if (op.type === 'delete') current.del.push(origBlocks[op.a])
        else current.ins.push(finalBlocks[op.b])
    }
    if (current) regions.push(current) // region runs to the end of the scene (anchor stays '')

    return regions
        .map((region) => {
            const beforeHtml = region.del.join('')
            const afterHtml = region.ins.join('')
            return {
                beforeHtml,
                afterHtml,
                beforeText: htmlToText(beforeHtml),
                afterText: htmlToText(afterHtml),
                anchorHash: anchorHashOf(afterHtml || beforeHtml),
                afterAnchorHtml: region.afterAnchorHtml,
            }
        })
        .filter((region) => region.beforeHtml || region.afterHtml)
}

// Undo a previously applied hunk by swapping afterHtml back to beforeHtml in the
// current scene HTML. Fails (by design) when the region was changed again afterwards.
function revertHunk(currentHtml, beforeHtml, afterHtml, afterAnchorHtml) {
    const src = String(currentHtml ?? '')
    const after = String(afterHtml ?? '')
    const before = String(beforeHtml ?? '')

    // Replacement or insertion: swap the new content back to the original.
    if (after) {
        const first = src.indexOf(after)
        if (first < 0) {
            return { ok: false, error: '该改动之后内容又有变化，无法自动撤销。' }
        }
        if (src.indexOf(after, first + 1) >= 0) {
            return { ok: false, error: '该改动之后内容又有变化，无法精确撤销。' }
        }
        return { ok: true, newHtml: src.slice(0, first) + before + src.slice(first + after.length) }
    }

    // Pure deletion: re-insert the removed blocks at their stored position anchor.
    if (!before) {
        return { ok: false, error: '没有可恢复的内容。' }
    }
    const anchor = String(afterAnchorHtml ?? '')
    if (!anchor) {
        // The region sat at the end of the scene (or the whole scene was deleted): append.
        return { ok: true, newHtml: src + before }
    }
    const at = src.indexOf(anchor)
    if (at < 0) {
        return { ok: false, error: '该改动之后内容又有变化，无法自动撤销。' }
    }
    if (src.indexOf(anchor, at + 1) >= 0) {
        return { ok: false, error: '该改动位置已不唯一，无法精确撤销。' }
    }
    return { ok: true, newHtml: src.slice(0, at) + before + src.slice(at) }
}

module.exports = {
    applyHunk,
    revertHunk,
    diffRegions,
    htmlToText,
    htmlToManuscriptMarkdown,
    manuscriptMarkdownToHtml,
    splitBlocks,
    blockText,
    blockMarkdown,
}
