import { detectCherryStudioModelTypes } from '@/lib/cherrystudio-model-config'
import { normalizeGroupModelTypes } from '@/lib/ai-group-config'
import type { PrismaClient } from '@/generated/prisma/client'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import { parseProviderType, resolveBaseUrl, type ProviderType } from '@/lib/server/ai-providers'

export type RetrievalModelCapability = 'embedding' | 'reranker'

export type RetrievalModelOption = {
    assignmentId: string
    modelId: string
    modelName: string
    groupName: string
    connectionName: string
    providerType: ProviderType
}

type LoadedRetrievalAssignment = RetrievalModelOption & {
    baseUrl: string
    apiKey: string
}

function safeJsonParse(value: string | null | undefined) {
    if (!value) return null
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

function isAssignmentAvailable(assignment: {
    manuallyDisabled: boolean
    ignoredUntil: Date | null
    connection: { isActive: boolean }
}) {
    if (!assignment.connection.isActive || assignment.manuallyDisabled) return false
    return !assignment.ignoredUntil || assignment.ignoredUntil.getTime() <= Date.now()
}

function getAssignmentCapability(assignment: {
    modelId: string
    group: { modelTypesJson: string | null }
    connection: { providerType: string; baseUrl: string | null }
}) {
    const groupTypes = normalizeGroupModelTypes(safeJsonParse(assignment.group.modelTypesJson))
    if (groupTypes) return groupTypes
    return detectCherryStudioModelTypes({
        modelId: assignment.modelId,
        providerType: parseProviderType(assignment.connection.providerType),
        baseUrl: assignment.connection.baseUrl,
    })
}

function getModelName(modelsJson: string, modelId: string) {
    const parsed = safeJsonParse(modelsJson)
    if (!Array.isArray(parsed)) return modelId
    const match = parsed.find(
        (item): item is { id: string; name?: string } =>
            Boolean(item)
            && typeof item === 'object'
            && (item as { id?: unknown }).id === modelId
    )
    return typeof match?.name === 'string' && match.name.trim() ? match.name.trim() : modelId
}

const retrievalAssignmentInclude = {
    group: { select: { name: true, modelTypesJson: true } },
    connection: {
        select: {
            name: true,
            providerType: true,
            baseUrl: true,
            encryptedApiKey: true,
            isActive: true,
            modelsJson: true,
        },
    },
} as const

export async function listRetrievalModelOptions(
    prisma: PrismaClient,
    ownerId: string,
    capability: RetrievalModelCapability
): Promise<RetrievalModelOption[]> {
    const assignments = await prisma.aiModelAssignment.findMany({
        where: { ownerId },
        include: retrievalAssignmentInclude,
        orderBy: [{ group: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    })

    return assignments.flatMap((assignment) => {
        const providerType = parseProviderType(assignment.connection.providerType)
        if (!providerType || !isAssignmentAvailable(assignment)) return []
        if (!getAssignmentCapability(assignment)[capability]) return []
        if (capability === 'reranker' && providerType !== 'openai-chat') return []
        return [{
            assignmentId: assignment.id,
            modelId: assignment.modelId,
            modelName: getModelName(assignment.connection.modelsJson, assignment.modelId),
            groupName: assignment.group.name,
            connectionName: assignment.connection.name,
            providerType,
        }]
    })
}

export async function loadRetrievalAssignment(
    prisma: PrismaClient,
    input: { ownerId: string; assignmentId: string; capability: RetrievalModelCapability }
): Promise<LoadedRetrievalAssignment> {
    const assignment = await prisma.aiModelAssignment.findFirst({
        where: { id: input.assignmentId, ownerId: input.ownerId },
        include: retrievalAssignmentInclude,
    })
    if (!assignment || !isAssignmentAvailable(assignment)) {
        throw new Error('Selected retrieval model is unavailable.')
    }

    const providerType = parseProviderType(assignment.connection.providerType)
    if (!providerType || !getAssignmentCapability(assignment)[input.capability]) {
        throw new Error(`Selected model does not support ${input.capability}.`)
    }
    if (input.capability === 'reranker' && providerType !== 'openai-chat') {
        throw new Error('The selected reranker connection does not expose an OpenAI-compatible rerank endpoint.')
    }

    return {
        assignmentId: assignment.id,
        modelId: assignment.modelId,
        modelName: getModelName(assignment.connection.modelsJson, assignment.modelId),
        groupName: assignment.group.name,
        connectionName: assignment.connection.name,
        providerType,
        baseUrl: resolveBaseUrl(providerType, assignment.connection.baseUrl),
        apiKey: decryptApiKey(assignment.connection.encryptedApiKey),
    }
}

async function parseProviderResponse(response: Response) {
    const data = await response.json().catch(() => null)
    if (!response.ok) {
        const detail =
            data && typeof data === 'object'
                ? (data as { error?: { message?: unknown }; message?: unknown }).error?.message
                    ?? (data as { message?: unknown }).message
                : null
        throw new Error(typeof detail === 'string' && detail.trim() ? detail : `Provider request failed (${response.status}).`)
    }
    return data
}

function validateEmbeddingVector(value: unknown): number[] {
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
        throw new Error('Embedding provider returned an invalid vector.')
    }
    return value as number[]
}

export async function createEmbeddings(
    assignment: LoadedRetrievalAssignment,
    texts: string[],
    signal?: AbortSignal
) {
    if (texts.length === 0) return []

    if (assignment.providerType === 'gemini') {
        const modelPath = assignment.modelId.startsWith('models/')
            ? assignment.modelId
            : `models/${assignment.modelId}`
        const response = await fetch(`${assignment.baseUrl}/${modelPath}:batchEmbedContents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': assignment.apiKey },
            body: JSON.stringify({
                requests: texts.map((text) => ({
                    model: modelPath,
                    content: { parts: [{ text }] },
                })),
            }),
            signal,
        })
        const data = await parseProviderResponse(response) as { embeddings?: Array<{ values?: unknown }> }
        const embeddings = Array.isArray(data?.embeddings) ? data.embeddings : []
        if (embeddings.length !== texts.length) throw new Error('Embedding provider returned an incomplete batch.')
        return embeddings.map((embedding) => validateEmbeddingVector(embedding.values))
    }

    const response = await fetch(`${assignment.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${assignment.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: assignment.modelId, input: texts }),
        signal,
    })
    const data = await parseProviderResponse(response) as {
        data?: Array<{ index?: number; embedding?: unknown }>
    }
    const embeddings = Array.isArray(data?.data) ? [...data.data] : []
    embeddings.sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    if (embeddings.length !== texts.length) throw new Error('Embedding provider returned an incomplete batch.')
    return embeddings.map((embedding) => validateEmbeddingVector(embedding.embedding))
}

export async function rerankDocuments(
    assignment: LoadedRetrievalAssignment,
    input: { query: string; documents: string[]; topN: number },
    signal?: AbortSignal
) {
    if (input.documents.length === 0) return []
    const response = await fetch(`${assignment.baseUrl}/rerank`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${assignment.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: assignment.modelId,
            query: input.query,
            documents: input.documents,
            top_n: Math.min(input.topN, input.documents.length),
            return_documents: false,
        }),
        signal,
    })
    const data = await parseProviderResponse(response) as {
        results?: Array<{ index?: unknown; relevance_score?: unknown; score?: unknown }>
        data?: Array<{ index?: unknown; relevance_score?: unknown; score?: unknown }>
    }
    const results = Array.isArray(data?.results) ? data.results : Array.isArray(data?.data) ? data.data : []
    return results
        .map((result) => ({
            index: typeof result.index === 'number' ? result.index : -1,
            score:
                typeof result.relevance_score === 'number'
                    ? result.relevance_score
                    : typeof result.score === 'number'
                      ? result.score
                      : Number.NaN,
        }))
        .filter(
            (result) =>
                Number.isInteger(result.index)
                && result.index >= 0
                && result.index < input.documents.length
                && Number.isFinite(result.score)
        )
        .sort((left, right) => right.score - left.score || left.index - right.index)
}
