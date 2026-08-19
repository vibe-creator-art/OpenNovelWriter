import { readFile } from 'fs/promises'
import { generateText, streamText, type LanguageModelUsage, type ModelMessage } from 'ai'
import { prisma } from '@/lib/db'
import { resolveManagedUploadPath } from '@/lib/server/storage'
import type { ModelAssignment, ModelGroup } from '@/lib/ai-store'
import {
    computeFailureUpdates,
    getResetAssignmentHealth,
    isVisionCapableModelGroup,
    normalizeFailurePolicy,
    normalizeGroupModelTypes,
    normalizeGroupSettings,
} from '@/lib/ai-group-config'
import { isAbortError } from '@/lib/server/abort-error'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import { createLanguageModel, parseProviderType } from '@/lib/server/ai-providers'

export class ModelGroupRunnerError extends Error {
    code: string
    retryable: boolean

    constructor(code: string, message: string, options?: { retryable?: boolean; cause?: unknown }) {
        super(message)
        this.name = 'ModelGroupRunnerError'
        this.code = code
        this.retryable = options?.retryable ?? false
        if (options?.cause !== undefined) {
            ;(this as Error & { cause?: unknown }).cause = options.cause
        }
    }
}

/** A chat message as sent by the client: plain text plus optional managed image URLs. */
export type RunModelMessage = ModelMessage & { images?: string[] }

type RunModelInput = {
    stream?: boolean
    system?: string
    temperature?: number
    maxTokens?: number
    messages?: RunModelMessage[]
    prompt?: string
}

async function readAttachmentBuffers(images: string[]) {
    const buffers: Buffer[] = []
    for (const url of images) {
        const filepath = typeof url === 'string' ? resolveManagedUploadPath(url) : null
        if (!filepath) continue
        try {
            buffers.push(await readFile(filepath))
        } catch {
            // attachment file vanished (e.g. GC'd) — send the rest without it
        }
    }
    return buffers
}

/** Expand user image attachments into AI SDK multimodal content with locally inlined bytes. */
async function resolveMessagesWithImages(messages: RunModelMessage[]): Promise<ModelMessage[]> {
    return Promise.all(
        messages.map(async (message) => {
            const { images, ...rest } = message
            if (rest.role !== 'user' || !Array.isArray(images) || images.length === 0 || typeof rest.content !== 'string') {
                return rest as ModelMessage
            }

            const buffers = await readAttachmentBuffers(images)
            if (buffers.length === 0) return rest as ModelMessage
            return {
                role: 'user',
                content: [
                    ...buffers.map((image) => ({ type: 'image' as const, image })),
                    ...(rest.content ? [{ type: 'text' as const, text: rest.content }] : []),
                ],
            } satisfies ModelMessage
        })
    )
}

type LoadedModelAssignment = ModelAssignment & {
    connection: {
        id: string
        name: string
        providerType: string
        baseUrl: string | null
        encryptedApiKey: string
    }
}

type LoadedModelGroup = Omit<ModelGroup, 'assignments'> & {
    assignments: LoadedModelAssignment[]
}

type LoadedModelGroupRecord = {
    id: string
    name: string
    settingsJson: string
    modelTypesJson: string | null
    failurePolicyJson: string
    pricingTiersJson: string
    assignments: Array<{
        id: string
        connectionId: string
        modelId: string
        failureCount: number
        ignoredUntil: Date | null
        manuallyDisabled: boolean
        connection: {
            id: string
            name: string
            providerType: string
            baseUrl: string | null
            encryptedApiKey: string
        }
    }>
}

function safeJsonParse<T = unknown>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback
    try {
        return JSON.parse(value) as T
    } catch {
        return fallback
    }
}

function isAssignmentAvailable(assignment: Pick<ModelAssignment, 'manuallyDisabled' | 'ignoredUntil'>, nowMs = Date.now()) {
    if (assignment.manuallyDisabled) return false
    if (!assignment.ignoredUntil) return true
    const timestamp = new Date(assignment.ignoredUntil).getTime()
    if (Number.isNaN(timestamp)) return true
    return timestamp <= nowMs
}

function toLoadedModelGroup(record: LoadedModelGroupRecord | null) {
    if (!record) return null
    return {
        id: record.id,
        name: record.name,
        fixed: false,
        assignments: record.assignments.map((assignment) => ({
            id: assignment.id,
            connectionId: assignment.connectionId,
            modelId: assignment.modelId,
            failureCount: assignment.failureCount,
            ignoredUntil: assignment.ignoredUntil ? assignment.ignoredUntil.toISOString() : null,
            manuallyDisabled: assignment.manuallyDisabled,
            connection: {
                id: assignment.connection.id,
                name: assignment.connection.name,
                providerType: assignment.connection.providerType,
                baseUrl: assignment.connection.baseUrl,
                encryptedApiKey: assignment.connection.encryptedApiKey,
            },
        })),
        modelTypes: normalizeGroupModelTypes(safeJsonParse(record.modelTypesJson, null)),
        settings: normalizeGroupSettings(safeJsonParse(record.settingsJson, {})),
        failurePolicy: normalizeFailurePolicy(safeJsonParse(record.failurePolicyJson, {})),
        pricingTiers: safeJsonParse(record.pricingTiersJson, [] as ModelGroup['pricingTiers']),
    } satisfies LoadedModelGroup
}

async function persistAssignmentState(
    assignmentId: string,
    updates: Partial<Pick<ModelAssignment, 'failureCount' | 'ignoredUntil' | 'manuallyDisabled'>>
) {
    await prisma.aiModelAssignment.update({
        where: { id: assignmentId },
        data: {
            ...(updates.failureCount !== undefined ? { failureCount: updates.failureCount } : {}),
            ...(updates.manuallyDisabled !== undefined ? { manuallyDisabled: updates.manuallyDisabled } : {}),
            ...(updates.ignoredUntil !== undefined
                ? { ignoredUntil: updates.ignoredUntil ? new Date(updates.ignoredUntil) : null }
                : {}),
        },
    })
}

export async function loadModelGroupForOwner(params: { ownerId: string; groupId: string }) {
    const record = await prisma.aiModelGroup.findFirst({
        where: {
            id: params.groupId,
            ownerId: params.ownerId,
        },
        include: {
            assignments: {
                orderBy: { sortOrder: 'asc' },
                include: {
                    connection: true,
                },
            },
        },
    })

    return toLoadedModelGroup(record)
}

export async function runModelGroupWithFallbackOnServer(options: {
    group: LoadedModelGroup
    input: RunModelInput
    preferredAssignmentId?: string | null
    signal?: AbortSignal
    onTextDelta?: (delta: string) => Promise<void> | void
    onReasoningDelta?: (delta: string) => Promise<void> | void
}): Promise<{ text: string; reasoningText?: string; usage?: LanguageModelUsage; usedAssignment: ModelAssignment }> {
    const nowMs = Date.now()
    const available = (options.group.assignments ?? []).filter((assignment) => isAssignmentAvailable(assignment, nowMs))

    if (available.length === 0) {
        throw new ModelGroupRunnerError(
            'MODEL_GROUP_UNAVAILABLE',
            `Model group "${options.group.name}" has no available assignments.`,
            { retryable: false }
        )
    }

    const preferredId = (options.preferredAssignmentId ?? '').trim()
    let startIndex = 0
    if (preferredId) {
        const matchedIndex = available.findIndex((assignment) => assignment.id === preferredId)
        if (matchedIndex >= 0) startIndex = matchedIndex
    }

    const attemptOrder = [...available.slice(startIndex), ...available.slice(0, startIndex)]
    // Non-vision groups get text only — image parts would hard-fail the whole request
    // at the provider, so stripping here keeps a mid-conversation model switch usable.
    const visionCapable = isVisionCapableModelGroup(options.group)
    const resolvedMessages =
        options.input.messages && options.input.messages.length > 0
            ? visionCapable
                ? await resolveMessagesWithImages(options.input.messages)
                : options.input.messages.map((message) => {
                      const next = { ...message }
                      delete next.images
                      return next as ModelMessage
                  })
            : null
    let lastError: unknown = null

    for (const [index, assignment] of attemptOrder.entries()) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

        try {
            const providerType = parseProviderType(assignment.connection.providerType)
            if (!providerType) {
                throw new ModelGroupRunnerError('UNSUPPORTED_PROVIDER', 'Unsupported provider type.', {
                    retryable: false,
                })
            }

            const apiKey = decryptApiKey(assignment.connection.encryptedApiKey)
            const model = createLanguageModel({
                providerType,
                apiKey,
                baseUrl: assignment.connection.baseUrl,
                modelId: assignment.modelId,
            })
            const stream = options.input.stream === true
            const requestPayload = {
                model,
                system: options.input.system,
                temperature: options.input.temperature,
                maxOutputTokens: options.input.maxTokens,
                abortSignal: options.signal,
                ...(resolvedMessages
                    ? { messages: resolvedMessages }
                    : { prompt: options.input.prompt ?? '' }),
            }

            let text = ''
            let reasoningText: string | undefined
            let usage: LanguageModelUsage

            if (!stream) {
                const result = await generateText(requestPayload)
                text = result.text
                reasoningText = result.reasoningText?.trim() ? result.reasoningText : undefined
                usage = result.usage
            } else {
                const result = streamText(requestPayload)
                let streamedReasoning = ''

                for await (const part of result.fullStream) {
                    if (part.type === 'text-delta' && part.text) {
                        text += part.text
                        await options.onTextDelta?.(part.text)
                    } else if (part.type === 'reasoning-delta' && part.text) {
                        streamedReasoning += part.text
                        await options.onReasoningDelta?.(part.text)
                    }
                }

                reasoningText = streamedReasoning.trim() ? streamedReasoning : undefined
                usage = await result.usage
            }

            if (assignment.failureCount !== 0 || assignment.ignoredUntil || assignment.manuallyDisabled) {
                await persistAssignmentState(assignment.id, getResetAssignmentHealth())
            }

            return {
                text,
                reasoningText,
                usage,
                usedAssignment: {
                    id: assignment.id,
                    connectionId: assignment.connectionId,
                    modelId: assignment.modelId,
                    failureCount: assignment.failureCount,
                    ignoredUntil: assignment.ignoredUntil,
                    manuallyDisabled: assignment.manuallyDisabled,
                },
            }
        } catch (error) {
            if (isAbortError(error, options.signal)) throw error

            lastError = error
            const failureUpdates = computeFailureUpdates({
                assignment,
                failurePolicy: options.group.failurePolicy,
                nowMs: Date.now(),
            })

            try {
                await persistAssignmentState(assignment.id, failureUpdates)
            } catch (persistError) {
                console.error('Failed to persist model assignment failure state:', persistError)
            }

            if (index === attemptOrder.length - 1) break
        }
    }

    if (lastError instanceof ModelGroupRunnerError) throw lastError

    const detail = lastError instanceof Error ? lastError.message : 'All model assignments failed.'
    throw new ModelGroupRunnerError('MODEL_GROUP_RUN_FAILED', detail, {
        retryable: true,
        cause: lastError,
    })
}
