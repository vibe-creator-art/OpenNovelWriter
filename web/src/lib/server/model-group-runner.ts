import { readFile } from 'fs/promises'
import { generateImage, generateText, streamText, type LanguageModelUsage, type ModelMessage } from 'ai'
import { prisma } from '@/lib/db'
import { resolveManagedUploadPath, saveImageBuffer } from '@/lib/server/storage'
import type { ModelAssignment, ModelGroup } from '@/lib/ai-store'
import {
    computeFailureUpdates,
    getResetAssignmentHealth,
    isVisionCapableModelGroup,
    normalizeFailurePolicy,
    normalizeGroupModelTypes,
    normalizeGroupSettings,
} from '@/lib/ai-group-config'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import { createImageModel, createLanguageModel, parseProviderType, type ProviderType } from '@/lib/server/ai-providers'
import { isImageGenerationModel } from '@/lib/cherrystudio-model-config'

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

function uploadMediaType(filepath: string) {
    const ext = filepath.split('.').pop()?.toLowerCase()
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
    if (ext === 'webp') return 'image/webp'
    if (ext === 'gif') return 'image/gif'
    return 'image/png'
}

async function readAttachmentBuffers(images: string[]) {
    const buffers: Array<{ data: Buffer; mediaType: string }> = []
    for (const url of images) {
        const filepath = typeof url === 'string' ? resolveManagedUploadPath(url) : null
        if (!filepath) continue
        try {
            buffers.push({ data: await readFile(filepath), mediaType: uploadMediaType(filepath) })
        } catch {
            // attachment file vanished (e.g. GC'd) — send the rest without it
        }
    }
    return buffers
}

/**
 * Expand `images` (managed `/uploads/...` URLs) into AI SDK multimodal content
 * parts: image parts on user messages, file parts on assistant messages (how
 * Gemini round-trips its own generated images for multi-turn editing; OpenAI
 * chat conversion silently drops assistant file parts). Image bytes are read
 * from local disk and inlined, so providers receive them regardless of whether
 * this server is reachable from the internet.
 */
async function resolveMessagesWithImages(messages: RunModelMessage[]): Promise<ModelMessage[]> {
    return Promise.all(
        messages.map(async (message) => {
            const { images, ...rest } = message
            if (!Array.isArray(images) || images.length === 0 || typeof rest.content !== 'string') {
                return rest as ModelMessage
            }
            const text = rest.content

            if (rest.role === 'user') {
                const buffers = await readAttachmentBuffers(images)
                if (buffers.length === 0) return rest as ModelMessage
                return {
                    role: 'user',
                    content: [
                        ...buffers.map(({ data }) => ({ type: 'image' as const, image: data })),
                        ...(text ? [{ type: 'text' as const, text }] : []),
                    ],
                } satisfies ModelMessage
            }

            if (rest.role === 'assistant') {
                const buffers = await readAttachmentBuffers(images)
                if (buffers.length === 0) return rest as ModelMessage
                return {
                    role: 'assistant',
                    content: [
                        ...(text ? [{ type: 'text' as const, text }] : []),
                        ...buffers.map(({ data, mediaType }) => ({ type: 'file' as const, data, mediaType })),
                    ],
                } satisfies ModelMessage
            }

            return rest as ModelMessage
        })
    )
}

/** Persist a model-emitted image file and return its markdown reference. */
async function saveGeneratedFileAsMarkdownRef(file: { uint8Array: Uint8Array; mediaType: string }) {
    const ext = file.mediaType?.split('/')[1] ?? 'png'
    const saved = await saveImageBuffer(Buffer.from(file.uint8Array), ext)
    return `![image](${saved.url})`
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

function isAbortError(error: unknown) {
    return (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError')
    )
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


/** The drawing instruction: the last non-empty user message, or the bare prompt. */
function getImageGenerationPrompt(input: RunModelInput) {
    for (let index = (input.messages?.length ?? 0) - 1; index >= 0; index -= 1) {
        const message = input.messages![index]
        if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
            return message.content.trim()
        }
    }
    return input.prompt?.trim() ?? ''
}

/**
 * Input images for an edit: the attachments of the last message (any role) that
 * has any. Generated images live on assistant messages, so a follow-up like
 * "change the hair to silver" must pick up the previous output as the canvas.
 */
async function getImageGenerationInputImages(input: RunModelInput): Promise<Buffer[]> {
    for (let index = (input.messages?.length ?? 0) - 1; index >= 0; index -= 1) {
        const message = input.messages![index]
        if (!Array.isArray(message?.images) || message.images.length === 0) continue

        const buffers: Buffer[] = []
        for (const url of message.images) {
            const filepath = typeof url === 'string' ? resolveManagedUploadPath(url) : null
            if (!filepath) continue
            try {
                buffers.push(await readFile(filepath))
            } catch {
                // attachment file vanished (e.g. GC'd) — edit with the rest
            }
        }
        return buffers
    }
    return []
}

/**
 * Run an `openai-image` connection model: `/images/edits` when the conversation
 * carries input images (and the model takes image input), otherwise
 * `/images/generations`. Generated images are persisted as managed uploads and
 * returned as markdown references — the chat message route lifts those into
 * message attachments on save.
 */
export async function runImageGenerationAttempt(params: {
    providerType: ProviderType
    apiKey: string
    baseUrl: string | null
    modelId: string
    input: RunModelInput
    allowImageInput?: boolean
    signal?: AbortSignal
    onTextDelta?: (delta: string) => Promise<void> | void
}): Promise<{ text: string; reasoningText?: string; usage?: LanguageModelUsage }> {
    const prompt = getImageGenerationPrompt(params.input)
    if (!prompt) {
        throw new ModelGroupRunnerError('IMAGE_PROMPT_REQUIRED', 'Image generation needs a text prompt.', {
            retryable: false,
        })
    }

    const inputImages = params.allowImageInput === false ? [] : await getImageGenerationInputImages(params.input)
    const result = await generateImage({
        model: createImageModel({
            providerType: params.providerType,
            apiKey: params.apiKey,
            baseUrl: params.baseUrl,
            modelId: params.modelId,
        }),
        prompt: inputImages.length > 0 ? { text: prompt, images: inputImages } : prompt,
        abortSignal: params.signal,
    })

    const urls: string[] = []
    for (const image of result.images) {
        const ext = image.mediaType?.split('/')[1] ?? 'png'
        const saved = await saveImageBuffer(Buffer.from(image.uint8Array), ext)
        urls.push(saved.url)
    }
    if (urls.length === 0) {
        throw new ModelGroupRunnerError('IMAGE_GENERATION_EMPTY', 'The model returned no image.', { retryable: true })
    }

    const text = urls.map((url) => `![image](${url})`).join('\n')
    await params.onTextDelta?.(text)
    return { text }
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

            const { text, reasoningText, usage } = providerType === 'openai-image'
                ? await runImageGenerationAttempt({
                      providerType,
                      apiKey,
                      baseUrl: assignment.connection.baseUrl,
                      modelId: assignment.modelId,
                      input: options.input,
                      allowImageInput: visionCapable,
                      signal: options.signal,
                      onTextDelta: options.onTextDelta,
                  })
                : await (async () => {
                      const model = createLanguageModel({
                          providerType,
                          apiKey,
                          baseUrl: assignment.connection.baseUrl,
                          modelId: assignment.modelId,
                      })

                      // Gemini image-output models (nano banana) return images as
                      // native file parts when IMAGE response modality is requested.
                      const imageOutput =
                          providerType === 'gemini' && isImageGenerationModel({ modelId: assignment.modelId })

                      const stream = options.input.stream === true
                      const requestPayload = {
                          model,
                          system: options.input.system,
                          temperature: options.input.temperature,
                          maxOutputTokens: options.input.maxTokens,
                          abortSignal: options.signal,
                          ...(imageOutput
                              ? { providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } } }
                              : {}),
                          ...(resolvedMessages
                              ? { messages: resolvedMessages }
                              : { prompt: options.input.prompt ?? '' }),
                      }

                      if (!stream) {
                          const result = await generateText(requestPayload)
                          let text = result.text
                          for (const file of result.files) {
                              if (!file.mediaType?.startsWith('image/')) continue
                              const ref = await saveGeneratedFileAsMarkdownRef(file)
                              text += text && !text.endsWith('\n') ? `\n${ref}` : ref
                          }
                          return {
                              text,
                              reasoningText: result.reasoningText?.trim() ? result.reasoningText : undefined,
                              usage: result.usage,
                          }
                      }

                      const result = streamText(requestPayload)
                      let text = ''
                      let reasoningText = ''

                      for await (const part of result.fullStream) {
                          if (part.type === 'text-delta' && part.text) {
                              text += part.text
                              await options.onTextDelta?.(part.text)
                              continue
                          }

                          if (part.type === 'file' && part.file.mediaType?.startsWith('image/')) {
                              const ref = await saveGeneratedFileAsMarkdownRef(part.file)
                              const delta = text && !text.endsWith('\n') ? `\n${ref}` : ref
                              text += delta
                              await options.onTextDelta?.(delta)
                              continue
                          }

                          if (part.type === 'reasoning-delta' && part.text) {
                              reasoningText += part.text
                              await options.onReasoningDelta?.(part.text)
                          }
                      }

                      return {
                          text,
                          reasoningText: reasoningText.trim() ? reasoningText : undefined,
                          usage: await result.usage,
                      }
                  })()

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
            if (isAbortError(error)) throw error

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
