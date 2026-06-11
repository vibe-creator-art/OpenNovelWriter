/* eslint-disable @typescript-eslint/no-require-imports */
// Block-level search/replace for manuscript (scene) HTML.
//
// Scene content is stored as TipTap HTML (a flat sequence of block elements such
// as <p>, <h2>, <blockquote>). Codex reads a lossy plain-text projection of it, so
// it proposes edits as { old_text -> new_text } search/replace hunks against that
// text. This module locates the hunk, rewrites only the block(s) it touches, and
// leaves every other block byte-identical so untouched formatting is preserved.

const crypto = require('crypto')

const BLOCK_RE = /<(p|h[1-6]|blockquote|pre|ul|ol|figure|table)\b[^>]*>[\s\S]*?<\/\1>|<hr\s*\/?>/gi

function decodeEntities(value) {
    return String(value)
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/ /g, ' ')
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
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

function htmlToText(html) {
    return buildProjection(splitBlocks(html)).text
}

// A regex that matches old_text with flexible whitespace (Codex may copy it with
// different spacing/newlines than the projection produced).
function buildFlexibleMatcher(oldText, flags) {
    const escaped = oldText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = escaped.replace(/\s+/g, '\\s+')
    return new RegExp(pattern, flags)
}

function textToHtml(text) {
    return String(text)
        .replace(/\r\n?/g, '\n')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
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
        const appended = textToHtml(rawNew)
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
    const projection = buildProjection(blocks)

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

    const sourceText = blocks.slice(firstBlock, lastBlock + 1).map(blockText).join('\n\n')
    const replacedText = sourceText.replace(buildFlexibleMatcher(rawOld), () => rawNew.trim())

    const beforeHtml = blocks.slice(firstBlock, lastBlock + 1).join('')
    const afterHtml = textToHtml(replacedText)

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
    const ops = diffBlockOps(origBlocks.map(blockText), finalBlocks.map(blockText))

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
    splitBlocks,
    blockText,
}
