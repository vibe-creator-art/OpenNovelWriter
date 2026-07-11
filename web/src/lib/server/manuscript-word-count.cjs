/* eslint-disable @typescript-eslint/no-require-imports */

function htmlToPlainText(html) {
    return String(html ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|h[1-6]|blockquote|pre|li)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

function calculateManuscriptWordCount(content) {
    const text = htmlToPlainText(content)
    if (!text) return 0

    const cjkCharacters = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length || 0
    const latinWords = text
        .replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length

    return cjkCharacters + latinWords
}

function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

async function getNovelTotalWordCount(db, novelId) {
    const aggregate = await db.scene.aggregate({
        where: { chapter: { novelId } },
        _sum: { wordCount: true },
    })
    return aggregate._sum.wordCount ?? 0
}

async function updateChapterWordCount(db, chapterId) {
    const aggregate = await db.scene.aggregate({
        where: { chapterId },
        _sum: { wordCount: true },
    })
    const wordCount = aggregate._sum.wordCount ?? 0
    await db.chapter.update({ where: { id: chapterId }, data: { wordCount } })
    return wordCount
}

async function recordNovelWritingDelta(db, novelId, delta, dateKey = getLocalDateKey()) {
    const endingWordCount = await getNovelTotalWordCount(db, novelId)
    if (delta !== 0) {
        await db.novelWritingDay.upsert({
            where: { novelId_dateKey: { novelId, dateKey } },
            create: { novelId, dateKey, netWordCount: delta, endingWordCount },
            update: { netWordCount: { increment: delta }, endingWordCount },
        })
    }
    return endingWordCount
}

async function updateSceneContentWithStats(prisma, sceneId, content, options = {}) {
    const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.scene.findUnique({
            where: { id: sceneId },
            select: { id: true, wordCount: true, chapterId: true, chapter: { select: { novelId: true } } },
        })
        if (!existing) throw new Error(`Scene ${sceneId} was not found.`)

        const wordCount = calculateManuscriptWordCount(content)
        const delta = wordCount - existing.wordCount
        const scene = await tx.scene.update({
            where: { id: sceneId },
            data: { content, wordCount },
        })
        await updateChapterWordCount(tx, existing.chapterId)
        const endingWordCount = options.recordStats === false
            ? await getNovelTotalWordCount(tx, existing.chapter.novelId)
            : await recordNovelWritingDelta(tx, existing.chapter.novelId, delta, options.dateKey)
        return { scene, delta, endingWordCount }
    })

    return result
}

module.exports = {
    calculateManuscriptWordCount,
    getLocalDateKey,
    getNovelTotalWordCount,
    updateChapterWordCount,
    recordNovelWritingDelta,
    updateSceneContentWithStats,
}
