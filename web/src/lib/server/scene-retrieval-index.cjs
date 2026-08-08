const crypto = require('node:crypto')

function decodeHtmlEntities(value) {
    return String(value)
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&amp;/g, '&')
}

function sceneHtmlToRetrievalText(html) {
    return decodeHtmlEntities(
        String(html ?? '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/\s*(p|h[1-6]|blockquote|pre|li|tr)\s*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
    )
        .normalize('NFKC')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function hashRetrievalText(text) {
    return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

async function syncSceneRetrievalIndex(db, input) {
    const searchText = sceneHtmlToRetrievalText(input.content)
    if (!searchText) {
        await db.sceneRetrievalIndex.deleteMany({ where: { sceneId: input.sceneId } })
        return null
    }

    const contentHash = hashRetrievalText(searchText)
    return db.sceneRetrievalIndex.upsert({
        where: { sceneId: input.sceneId },
        create: {
            sceneId: input.sceneId,
            novelId: input.novelId,
            searchText,
            contentHash,
        },
        update: {
            novelId: input.novelId,
            searchText,
            contentHash,
        },
    })
}

async function syncNovelSceneRetrievalIndexes(db, novelId) {
    const [scenes, indexes] = await Promise.all([
        db.scene.findMany({
            where: { chapter: { novelId } },
            select: { id: true, content: true },
        }),
        db.sceneRetrievalIndex.findMany({
            where: { novelId },
            select: { sceneId: true, contentHash: true },
        }),
    ])
    const hashesBySceneId = new Map(indexes.map((index) => [index.sceneId, index.contentHash]))
    let updated = 0

    for (const scene of scenes) {
        const searchText = sceneHtmlToRetrievalText(scene.content)
        const contentHash = searchText ? hashRetrievalText(searchText) : null
        if (contentHash && hashesBySceneId.get(scene.id) === contentHash) continue
        if (!contentHash && !hashesBySceneId.has(scene.id)) continue
        await syncSceneRetrievalIndex(db, {
            sceneId: scene.id,
            novelId,
            content: scene.content,
        })
        updated += 1
    }

    return { sceneCount: scenes.length, updated }
}

module.exports = {
    hashRetrievalText,
    sceneHtmlToRetrievalText,
    syncNovelSceneRetrievalIndexes,
    syncSceneRetrievalIndex,
}
