export const RETRIEVAL_RRF_K = 60
export const RETRIEVAL_BM25_K1 = 1.2
export const RETRIEVAL_BM25_B = 0.75

const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu
const LATIN_WORD = /[\p{L}\p{N}]+/gu

export function tokenizeForRetrieval(value: string) {
    const normalized = value.normalize('NFKC').toLocaleLowerCase()
    const tokens: string[] = []

    for (const match of normalized.matchAll(CJK_RUN)) {
        const characters = Array.from(match[0])
        if (characters.length === 1) tokens.push(`c:${characters[0]}`)
        for (let index = 0; index + 1 < characters.length; index += 1) {
            tokens.push(`c2:${characters[index]}${characters[index + 1]}`)
        }
        for (let index = 0; index + 2 < characters.length; index += 1) {
            tokens.push(`c3:${characters[index]}${characters[index + 1]}${characters[index + 2]}`)
        }
    }

    const nonCjk = normalized.replace(CJK_RUN, ' ')
    for (const match of nonCjk.matchAll(LATIN_WORD)) {
        tokens.push(`w:${match[0]}`)
    }

    return tokens
}

export type RankedItem = { id: string; score: number; rank: number }

export function rankBm25(
    query: string,
    documents: Array<{ id: string; text: string }>,
    limit: number
): RankedItem[] {
    if (!query.trim() || documents.length === 0 || limit <= 0) return []

    const queryTokens = tokenizeForRetrieval(query)
    if (queryTokens.length === 0) return []

    const queryFrequencies = new Map<string, number>()
    for (const token of queryTokens) {
        queryFrequencies.set(token, (queryFrequencies.get(token) ?? 0) + 1)
    }

    const documentTokens = documents.map((document) => {
        const tokens = tokenizeForRetrieval(document.text)
        const frequencies = new Map<string, number>()
        for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
        return { ...document, length: tokens.length, frequencies }
    })
    const averageLength = Math.max(
        1,
        documentTokens.reduce((sum, document) => sum + document.length, 0) / documentTokens.length
    )
    const documentFrequencies = new Map<string, number>()
    for (const token of queryFrequencies.keys()) {
        documentFrequencies.set(
            token,
            documentTokens.reduce(
                (count, document) => count + (document.frequencies.has(token) ? 1 : 0),
                0
            )
        )
    }

    const scores = documentTokens.map((document) => {
        let score = 0
        for (const [token, queryFrequency] of queryFrequencies) {
            const termFrequency = document.frequencies.get(token) ?? 0
            if (termFrequency === 0) continue
            const documentFrequency = documentFrequencies.get(token) ?? 0
            const inverseDocumentFrequency = Math.log(
                1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5)
            )
            const lengthNormalization =
                termFrequency
                + RETRIEVAL_BM25_K1
                    * (1 - RETRIEVAL_BM25_B + RETRIEVAL_BM25_B * (document.length / averageLength))
            score +=
                queryFrequency
                * inverseDocumentFrequency
                * ((termFrequency * (RETRIEVAL_BM25_K1 + 1)) / lengthNormalization)
        }
        return { id: document.id, score }
    })

    return scores
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, limit)
        .map((item, index) => ({ ...item, rank: index + 1 }))
}

export function cosineSimilarity(left: number[], right: number[]) {
    if (left.length === 0 || left.length !== right.length) return null
    let dot = 0
    let leftMagnitude = 0
    let rightMagnitude = 0
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index]
        leftMagnitude += left[index] * left[index]
        rightMagnitude += right[index] * right[index]
    }
    if (leftMagnitude === 0 || rightMagnitude === 0) return null
    return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

export function rankVectors(
    queryVector: number[],
    documents: Array<{ id: string; vector: number[] }>,
    limit: number
): RankedItem[] {
    return documents
        .map((document) => ({ id: document.id, score: cosineSimilarity(queryVector, document.vector) }))
        .filter((item): item is { id: string; score: number } => item.score !== null)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, limit)
        .map((item, index) => ({ ...item, rank: index + 1 }))
}

export function reciprocalRankFusion(rankings: RankedItem[][], limit: number): RankedItem[] {
    const scores = new Map<string, number>()
    for (const ranking of rankings) {
        for (const item of ranking) {
            scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (RETRIEVAL_RRF_K + item.rank))
        }
    }

    return Array.from(scores, ([id, score]) => ({ id, score }))
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, limit)
        .map((item, index) => ({ ...item, rank: index + 1 }))
}

export function getRetrievalCandidateLimit(topK: number) {
    return Math.min(100, Math.max(40, topK * 4))
}
