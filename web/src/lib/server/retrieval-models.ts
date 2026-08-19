import { detectCherryStudioModelTypes } from '@/lib/cherrystudio-model-config'
import {
    computeFailureUpdates,
    getResetAssignmentHealth,
    normalizeFailurePolicy,
    normalizeGroupModelTypes,
    type FailurePolicy,
} from '@/lib/ai-group-config'
import type { PrismaClient } from '@/generated/prisma/client'
import { isAbortError } from '@/lib/server/abort-error'
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

export type RetrievalModelGroupOption = {
    groupId: string
    groupName: string
    models: RetrievalModelOption[]
}

type LoadedRetrievalAssignment = RetrievalModelOption & {
    baseUrl: string
    apiKey: string
    failureCount: number
    ignoredUntil: Date | null
    manuallyDisabled: boolean
}

export type LoadedRetrievalGroup = {
    groupId: string
    groupName: string
    failurePolicy: FailurePolicy
    assignments: LoadedRetrievalAssignment[]
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
    group: { select: { id: true, name: true, modelTypesJson: true, failurePolicyJson: true } },
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

function toLoadedAssignment(assignment: {
    id: string
    modelId: string
    failureCount: number
    ignoredUntil: Date | null
    manuallyDisabled: boolean
    group: { id: string; name: string }
    connection: {
        name: string
        providerType: string
        baseUrl: string | null
        encryptedApiKey: string
        modelsJson: string
    }
}) {
    const providerType = parseProviderType(assignment.connection.providerType)
    if (!providerType) return null
    return {
        assignmentId: assignment.id,
        modelId: assignment.modelId,
        modelName: getModelName(assignment.connection.modelsJson, assignment.modelId),
        groupName: assignment.group.name,
        connectionName: assignment.connection.name,
        providerType,
        baseUrl: resolveBaseUrl(providerType, assignment.connection.baseUrl),
        apiKey: decryptApiKey(assignment.connection.encryptedApiKey),
        failureCount: assignment.failureCount,
        ignoredUntil: assignment.ignoredUntil,
        manuallyDisabled: assignment.manuallyDisabled,
    } satisfies LoadedRetrievalAssignment
}

export async function listRetrievalModelGroups(
    prisma: PrismaClient,
    ownerId: string,
    capability: RetrievalModelCapability
): Promise<RetrievalModelGroupOption[]> {
    const assignments = await prisma.aiModelAssignment.findMany({
        where: { ownerId },
        include: retrievalAssignmentInclude,
        orderBy: [{ group: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    })

    const grouped = new Map<string, RetrievalModelGroupOption>()
    for (const assignment of assignments) {
        const providerType = parseProviderType(assignment.connection.providerType)
        if (!providerType || !isAssignmentAvailable(assignment)) continue
        if (!getAssignmentCapability(assignment)[capability]) continue
        if (capability === 'reranker' && providerType !== 'openai-chat') continue
        const option = {
            assignmentId: assignment.id,
            modelId: assignment.modelId,
            modelName: getModelName(assignment.connection.modelsJson, assignment.modelId),
            groupName: assignment.group.name,
            connectionName: assignment.connection.name,
            providerType,
        }
        const current = grouped.get(assignment.group.id)
        if (current) {
            current.models.push(option)
        } else {
            grouped.set(assignment.group.id, {
                groupId: assignment.group.id,
                groupName: assignment.group.name,
                models: [option],
            })
        }
    }
    return Array.from(grouped.values())
}

export async function loadRetrievalGroup(
    prisma: PrismaClient,
    input: { ownerId: string; groupId: string; capability: RetrievalModelCapability }
): Promise<LoadedRetrievalGroup> {
    const group = await prisma.aiModelGroup.findFirst({
        where: { id: input.groupId, ownerId: input.ownerId },
        select: {
            id: true,
            name: true,
            failurePolicyJson: true,
            assignments: {
                include: retrievalAssignmentInclude,
                orderBy: { sortOrder: 'asc' },
            },
        },
    })
    if (!group) throw new Error('Selected retrieval model group is unavailable.')

    const assignments = group.assignments.flatMap((assignment) => {
        const providerType = parseProviderType(assignment.connection.providerType)
        if (!providerType || !isAssignmentAvailable(assignment)) return []
        if (!getAssignmentCapability(assignment)[input.capability]) return []
        if (input.capability === 'reranker' && providerType !== 'openai-chat') return []
        const loaded = toLoadedAssignment(assignment)
        return loaded ? [loaded] : []
    })
    if (assignments.length === 0) {
        throw new Error(`Selected retrieval model group has no available ${input.capability} assignment.`)
    }
    return {
        groupId: group.id,
        groupName: group.name,
        failurePolicy: normalizeFailurePolicy(safeJsonParse(group.failurePolicyJson)),
        assignments,
    }
}

async function runRetrievalGroupWithFallback<T>(
    prisma: PrismaClient,
    group: LoadedRetrievalGroup,
    run: (assignment: LoadedRetrievalAssignment) => Promise<T>
) {
    let lastError: unknown = null
    for (const assignment of group.assignments) {
        try {
            const value = await run(assignment)
            if (assignment.failureCount || assignment.ignoredUntil || assignment.manuallyDisabled) {
                await prisma.aiModelAssignment.update({
                    where: { id: assignment.assignmentId },
                    data: getResetAssignmentHealth(),
                })
            }
            return { value, assignment }
        } catch (error) {
            if (isAbortError(error)) throw error
            lastError = error
            const updates = computeFailureUpdates({
                assignment: {
                    failureCount: assignment.failureCount,
                    ignoredUntil: assignment.ignoredUntil?.toISOString() ?? null,
                    manuallyDisabled: assignment.manuallyDisabled,
                },
                failurePolicy: group.failurePolicy,
            })
            await prisma.aiModelAssignment.update({
                where: { id: assignment.assignmentId },
                data: {
                    failureCount: updates.failureCount,
                    ignoredUntil: updates.ignoredUntil ? new Date(updates.ignoredUntil) : null,
                    manuallyDisabled: updates.manuallyDisabled,
                },
            }).catch(() => {})
        }
    }
    throw lastError instanceof Error ? lastError : new Error(`All assignments in ${group.groupName} failed.`)
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

async function createEmbeddings(
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

export async function createEmbeddingsWithGroup(
    prisma: PrismaClient,
    group: LoadedRetrievalGroup,
    texts: string[],
    signal?: AbortSignal
) {
    const result = await runRetrievalGroupWithFallback(
        prisma,
        group,
        (assignment) => createEmbeddings(assignment, texts, signal)
    )
    return { vectors: result.value, assignment: result.assignment }
}

async function rerankDocuments(
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

export async function rerankDocumentsWithGroup(
    prisma: PrismaClient,
    group: LoadedRetrievalGroup,
    input: { query: string; documents: string[]; topN: number },
    signal?: AbortSignal
) {
    const result = await runRetrievalGroupWithFallback(
        prisma,
        group,
        (assignment) => rerankDocuments(assignment, input, signal)
    )
    return { results: result.value, assignment: result.assignment }
}
