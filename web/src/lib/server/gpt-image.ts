import fs from 'fs/promises'
import path from 'path'

import { getCodexSessionWorkspacePath } from '@/lib/server/codex-session-workspace'
import {
    resolveGptImageProvider,
    type GptImageProvider,
} from '@/lib/server/gpt-image-connection'

const DEFAULT_REQUEST_TIMEOUT_MS = 1_800_000
const MAX_BATCH_IMAGES = 64
const MAX_IMAGES_PER_REQUEST = 10
const MAX_INPUT_IMAGES = 16
const MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.webp'])
const ALLOWED_QUALITIES = new Set(['auto', 'low', 'medium', 'high'])
const ALLOWED_BACKGROUNDS = new Set(['auto', 'opaque'])
const ALLOWED_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp'])
const ALLOWED_MODERATION = new Set(['auto', 'low'])

type JsonObject = Record<string, unknown>

type ImageReference = {
    path: string
    role: string | null
}

type ImageJobOptions = {
    size: string
    quality: string
    n: number
    background: string | null
    outputFormat: 'png' | 'jpeg' | 'webp'
    outputCompression: number | null
    moderation: string | null
}

type ImageJob = ImageJobOptions & {
    id: string
    label: string
    prompt: string
    images: ImageReference[]
    mask: string | null
}

type ImageBatch = {
    title: string
    items: ImageJob[]
}

type ResolvedImageReference = ImageReference & {
    realPath: string
    artifactPath: string
}

type ResolvedImageJob = Omit<ImageJob, 'images' | 'mask'> & {
    images: ResolvedImageReference[]
    mask: { realPath: string; artifactPath: string } | null
}

export type GeneratedImageArtifact = {
    ok: true
    ref: string
    suggestedLink: string
    imageCount: number
    manifestPath: string
    items: Array<{ id: string; label: string; ref: string }>
}

type GenerateCodexImageArtifactsInput = {
    ownerId: string
    sessionId: string
    directoryPath: string
    batch: ImageBatch
    signal?: AbortSignal
}

export function normalizeGptImageBatch(value: unknown): ImageBatch {
    const input = requireObject(value, 'image request')
    const title = optionalString(input.title, 'title', 120) ?? 'Generated images'
    const rawItems = Array.isArray(input.items) ? input.items : null
    if (!rawItems || rawItems.length === 0) {
        throw new Error('Image request must contain at least one item.')
    }
    if (rawItems.length > MAX_BATCH_IMAGES) {
        throw new Error(`Image request supports at most ${MAX_BATCH_IMAGES} items.`)
    }

    const common = normalizeJobOptions(input)
    const ids = new Set<string>()
    const items = rawItems.map((rawItem, index) => {
        const item = requireObject(rawItem, `items[${index}]`)
        const id = normalizeImageId(item.id, index)
        if (ids.has(id)) throw new Error(`Duplicate image item id: ${id}`)
        ids.add(id)
        return normalizeJob(item, common, id, index)
    })
    const totalImages = items.reduce((total, item) => total + item.n, 0)
    if (totalImages > MAX_BATCH_IMAGES) {
        throw new Error(`Image request may produce at most ${MAX_BATCH_IMAGES} images.`)
    }
    return { title, items }
}

export function normalizeGptImageDirect(value: unknown): ImageBatch {
    const input = requireObject(value, 'image request')
    const common = normalizeJobOptions(input)
    const id = normalizeImageId(input.id, 0)
    const item = normalizeJob(input, common, id, 0)
    return {
        title: optionalString(input.title, 'title', 120) ?? item.label,
        items: [item],
    }
}

export function validateGptImageSize(value: unknown): string {
    const size = optionalString(value, 'size', 32)?.toLowerCase() ?? 'auto'
    if (size === 'auto') return size
    const match = /^(\d+)x(\d+)$/.exec(size)
    if (!match) throw new Error('size must be "auto" or a value such as 1024x1024.')
    const width = Number(match[1])
    const height = Number(match[2])
    const shortEdge = Math.min(width, height)
    const longEdge = Math.max(width, height)
    const pixels = width * height
    if (width % 16 !== 0 || height % 16 !== 0) {
        throw new Error('size width and height must both be multiples of 16.')
    }
    if (longEdge > 3840) throw new Error('size cannot exceed 3840px on either edge.')
    if (shortEdge === 0 || longEdge / shortEdge > 3) {
        throw new Error('size aspect ratio cannot exceed 3:1.')
    }
    if (pixels < 655_360 || pixels > 8_294_400) {
        throw new Error('size total pixels must be between 655360 and 8294400.')
    }
    return size
}

export async function generateCodexImageArtifacts(
    input: GenerateCodexImageArtifactsInput
): Promise<GeneratedImageArtifact> {
    const provider = await resolveGptImageProvider(input.ownerId)
    return generateCodexImageArtifactsWithProvider(input, provider)
}

export async function generateCodexImageArtifactsWithProvider(
    input: GenerateCodexImageArtifactsInput,
    provider: GptImageProvider
): Promise<GeneratedImageArtifact> {
    const { apiKey, baseUrl, modelId: model } = provider
    const paths = await resolveOutputDirectory(input.ownerId, input.sessionId, input.directoryPath)
    const tempDirectory = await fs.mkdtemp(path.join(paths.parent, `.${paths.name}-`))
    const manifestItems: JsonObject[] = []

    try {
        for (const job of input.batch.items) {
            const resolved = await resolveJobInputs(job, paths.artifactsRoot)
            const prompt = appendImageRoles(resolved.prompt, resolved.images)
            const results = await requestImages({ apiKey, baseUrl, model, job: resolved, prompt, signal: input.signal })
            for (let index = 0; index < results.length; index += 1) {
                const result = results[index]
                const variantId = results.length === 1 ? resolved.id : `${resolved.id}-v${index + 1}`
                const fileName = `${variantId}.${resolved.outputFormat}`
                await fs.writeFile(path.join(tempDirectory, fileName), result.bytes)
                manifestItems.push({
                    id: variantId,
                    label: results.length === 1 ? resolved.label : `${resolved.label} ${index + 1}`,
                    file: fileName,
                    prompt,
                    ...(result.revisedPrompt ? { revisedPrompt: result.revisedPrompt } : {}),
                    mode: resolved.images.length > 0 ? 'edit' : 'generate',
                    size: resolved.size,
                    quality: resolved.quality,
                    references: resolved.images.map((image) => ({
                        file: image.artifactPath,
                        ...(image.role ? { role: image.role } : {}),
                    })),
                    ...(resolved.mask ? { mask: resolved.mask.artifactPath } : {}),
                })
            }
        }

        const manifest = {
            title: input.batch.title,
            model,
            createdAt: new Date().toISOString(),
            items: manifestItems,
        }
        await fs.writeFile(path.join(tempDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
        await fs.rename(tempDirectory, paths.target)
    } catch (error) {
        await fs.rm(tempDirectory, { recursive: true, force: true })
        throw error
    }

    const manifestPath = toPosixPath(path.relative(paths.artifactsRoot, path.join(paths.target, 'manifest.json')))
    const ref = `image:${manifestPath}`
    const linkLabel = input.batch.title.replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Generated images'
    return {
        ok: true,
        ref,
        suggestedLink: `[${linkLabel}](${ref})`,
        imageCount: manifestItems.length,
        manifestPath,
        items: manifestItems.map((item) => {
            const id = String(item.id)
            return {
                id,
                label: String(item.label),
                ref: `${ref}#${id}`,
            }
        }),
    }
}

function normalizeJob(
    input: JsonObject,
    common: ReturnType<typeof normalizeJobOptions>,
    id: string,
    index: number
): ImageJob {
    const options = normalizeJobOptions(input, common)
    const prompt = requireNonEmptyString(input.prompt, `items[${index}].prompt`, 32_000)
    const label = optionalString(input.label, `items[${index}].label`, 120) ?? id
    return {
        id,
        label,
        prompt,
        images: normalizeImageReferences(input.images, `items[${index}].images`),
        mask: optionalString(input.mask, `items[${index}].mask`, 4096),
        ...options,
    }
}

function normalizeJobOptions(input: JsonObject, fallback?: ImageJobOptions): ImageJobOptions {
    const quality = enumValue(input.quality, 'quality', ALLOWED_QUALITIES, fallback?.quality ?? 'high')
    const background = nullableEnumValue(input.background, 'background', ALLOWED_BACKGROUNDS, fallback?.background ?? null)
    const outputFormat = enumValue(
        input.outputFormat,
        'outputFormat',
        ALLOWED_OUTPUT_FORMATS,
        fallback?.outputFormat ?? 'png'
    ) as 'png' | 'jpeg' | 'webp'
    const outputCompression = optionalInteger(
        input.outputCompression,
        'outputCompression',
        0,
        100,
        fallback?.outputCompression ?? null
    )
    if (outputCompression !== null && outputFormat === 'png') {
        throw new Error('outputCompression is only valid with jpeg or webp output.')
    }
    return {
        size: input.size === undefined ? fallback?.size ?? 'auto' : validateGptImageSize(input.size),
        quality,
        n: optionalInteger(input.n, 'n', 1, MAX_IMAGES_PER_REQUEST, fallback?.n ?? 1) ?? 1,
        background,
        outputFormat,
        outputCompression,
        moderation: nullableEnumValue(input.moderation, 'moderation', ALLOWED_MODERATION, fallback?.moderation ?? null),
    }
}

function normalizeImageReferences(value: unknown, name: string): ImageReference[] {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw new Error(`${name} must be an array.`)
    if (value.length > MAX_INPUT_IMAGES) throw new Error(`${name} supports at most ${MAX_INPUT_IMAGES} files.`)
    return value.map((entry, index) => {
        if (typeof entry === 'string') {
            return { path: requireNonEmptyString(entry, `${name}[${index}]`, 4096), role: null }
        }
        const record = requireObject(entry, `${name}[${index}]`)
        return {
            path: requireNonEmptyString(record.path, `${name}[${index}].path`, 4096),
            role: optionalString(record.role, `${name}[${index}].role`, 200),
        }
    })
}

async function resolveJobInputs(job: ImageJob, artifactsRoot: string): Promise<ResolvedImageJob> {
    const images = await Promise.all(job.images.map(async (image) => ({
        ...image,
        ...await resolveArtifactImagePath(artifactsRoot, image.path),
    })))
    const mask = job.mask ? await resolveArtifactImagePath(artifactsRoot, job.mask) : null
    if (mask && images.length === 0) throw new Error('A mask requires at least one input image.')
    if (mask) await validateMaskCompatibility(images[0].realPath, mask.realPath)
    return { ...job, images, mask }
}

async function resolveArtifactImagePath(artifactsRoot: string, rawPath: string) {
    const target = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(artifactsRoot, rawPath)
    const realPath = await fs.realpath(target).catch(() => null)
    if (!realPath) throw new Error(`Image input was not found: ${rawPath}`)
    const relative = path.relative(artifactsRoot, realPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Image input must be inside this session artifacts directory: ${rawPath}`)
    }
    const extension = path.extname(realPath).toLowerCase()
    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported image input format: ${rawPath}`)
    }
    const stat = await fs.stat(realPath)
    if (!stat.isFile()) throw new Error(`Image input is not a file: ${rawPath}`)
    if (stat.size > MAX_INPUT_FILE_BYTES) throw new Error(`Image input exceeds 50 MB: ${rawPath}`)
    return { realPath, artifactPath: toPosixPath(relative) }
}

async function resolveOutputDirectory(ownerId: string, sessionId: string, rawPath: string) {
    if (!path.isAbsolute(rawPath)) throw new Error('directoryPath must be an absolute path.')
    const artifactsRoot = path.join(getCodexSessionWorkspacePath(ownerId, sessionId), 'artifacts')
    await fs.mkdir(artifactsRoot, { recursive: true })
    const realArtifactsRoot = await fs.realpath(artifactsRoot)
    const requestedTarget = path.resolve(rawPath)
    const realRelative = path.relative(realArtifactsRoot, requestedTarget)
    const unresolvedRelative = path.relative(path.resolve(artifactsRoot), requestedTarget)
    const relative = isContainedRelative(realRelative) ? realRelative : unresolvedRelative
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('directoryPath must be inside this Codex session artifacts directory.')
    }
    const target = path.resolve(realArtifactsRoot, relative)
    const parent = path.dirname(target)
    await fs.mkdir(parent, { recursive: true })
    const realParent = await fs.realpath(parent)
    const parentRelative = path.relative(realArtifactsRoot, realParent)
    if (parentRelative.startsWith('..') || path.isAbsolute(parentRelative)) {
        throw new Error('directoryPath must be inside this Codex session artifacts directory.')
    }
    const exists = await fs.lstat(target).then(() => true, () => false)
    if (exists) throw new Error('directoryPath already exists. Choose a new directory name.')
    return {
        artifactsRoot: realArtifactsRoot,
        target,
        parent: realParent,
        name: path.basename(target),
    }
}

function isContainedRelative(value: string) {
    return Boolean(value) && !value.startsWith('..') && !path.isAbsolute(value)
}

async function requestImages(input: {
    apiKey: string
    baseUrl: string
    model: string
    job: ResolvedImageJob
    prompt: string
    signal?: AbortSignal
}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS)
    const abort = () => controller.abort()
    input.signal?.addEventListener('abort', abort, { once: true })
    try {
        const response = input.job.images.length > 0
            ? await postImageEdit(input, controller.signal)
            : await postImageGeneration(input, controller.signal)
        return await extractImageResults(response, controller.signal)
    } catch (error) {
        if (controller.signal.aborted && !input.signal?.aborted) {
            throw new Error(`Image request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS / 1000} seconds.`)
        }
        throw error
    } finally {
        clearTimeout(timeout)
        input.signal?.removeEventListener('abort', abort)
    }
}

async function postImageGeneration(
    input: { apiKey: string; baseUrl: string; model: string; job: ResolvedImageJob; prompt: string },
    signal: AbortSignal
) {
    const payload = removeNullValues({
        model: input.model,
        prompt: input.prompt,
        size: input.job.size,
        quality: input.job.quality,
        n: input.job.n,
        background: input.job.background,
        output_format: input.job.outputFormat,
        output_compression: input.job.outputCompression,
        moderation: input.job.moderation,
    })
    return fetchProviderJson(`${input.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
    })
}

async function postImageEdit(
    input: { apiKey: string; baseUrl: string; model: string; job: ResolvedImageJob; prompt: string },
    signal: AbortSignal
) {
    const form = new FormData()
    const fields = removeNullValues({
        model: input.model,
        prompt: input.prompt,
        size: input.job.size,
        quality: input.job.quality,
        n: input.job.n,
        background: input.job.background,
        output_format: input.job.outputFormat,
        output_compression: input.job.outputCompression,
        moderation: input.job.moderation,
    })
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value))
    for (const image of input.job.images) {
        form.append('image[]', await fileBlob(image.realPath), path.basename(image.realPath))
    }
    if (input.job.mask) {
        form.append('mask', await fileBlob(input.job.mask.realPath), path.basename(input.job.mask.realPath))
    }
    return fetchProviderJson(`${input.baseUrl}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}` },
        body: form,
        signal,
    })
}

async function fileBlob(filePath: string) {
    const bytes = await fs.readFile(filePath)
    return new Blob([bytes], { type: mimeTypeForExtension(path.extname(filePath)) })
}

async function fetchProviderJson(url: string, init: RequestInit): Promise<JsonObject> {
    let response: Response
    try {
        response = await fetch(url, init)
    } catch (error) {
        throw new Error(`Failed to connect to image provider: ${error instanceof Error ? error.message : String(error)}`)
    }
    const text = await response.text()
    const payload = text ? tryParseJson(text) : null
    if (!response.ok) {
        const detail = providerErrorDetail(payload) || text.slice(0, 2000) || response.statusText
        throw new Error(`Image provider returned HTTP ${response.status}: ${detail}`)
    }
    if (!payload) throw new Error('Image provider returned an invalid JSON response.')
    return payload
}

async function extractImageResults(payload: JsonObject, signal: AbortSignal) {
    if (!Array.isArray(payload.data) || payload.data.length === 0) {
        throw new Error('Image provider response did not contain image data.')
    }
    return Promise.all(payload.data.map(async (entry, index) => {
        const item = requireObject(entry, `provider data[${index}]`)
        const revisedPrompt = optionalString(item.revised_prompt, `provider data[${index}].revised_prompt`, 32_000)
        if (typeof item.b64_json === 'string' && item.b64_json) {
            const bytes = Buffer.from(item.b64_json, 'base64')
            if (bytes.length === 0) throw new Error(`Image provider returned empty data for image ${index + 1}.`)
            return { bytes, revisedPrompt }
        }
        if (typeof item.url === 'string' && item.url) {
            const response = await fetch(item.url, { signal })
            if (!response.ok) throw new Error(`Failed to download provider image ${index + 1} (${response.status}).`)
            return { bytes: Buffer.from(await response.arrayBuffer()), revisedPrompt }
        }
        throw new Error(`Image provider result ${index + 1} did not contain b64_json or url.`)
    }))
}

function appendImageRoles(prompt: string, images: ResolvedImageReference[]) {
    const roles = images
        .map((image, index) => image.role ? `Image ${index + 1}: ${image.role}` : null)
        .filter((value): value is string => value !== null)
    return roles.length > 0 ? `${prompt}\n\nInput image roles:\n${roles.join('\n')}` : prompt
}

type ImageInfo = { format: 'png' | 'jpeg' | 'webp'; width: number; height: number; hasAlpha: boolean }

async function validateMaskCompatibility(sourcePath: string, maskPath: string) {
    const source = inspectImage(await fs.readFile(sourcePath), sourcePath)
    const mask = inspectImage(await fs.readFile(maskPath), maskPath)
    if (source.format !== mask.format) throw new Error('mask must use the same format as the first input image.')
    if (source.width !== mask.width || source.height !== mask.height) {
        throw new Error('mask dimensions must match the first input image.')
    }
    if (!mask.hasAlpha) throw new Error('mask must include an alpha channel.')
}

function inspectImage(bytes: Buffer, filePath: string): ImageInfo {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        if (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`Invalid PNG: ${filePath}`)
        const colorType = bytes[25]
        return {
            format: 'png',
            width: bytes.readUInt32BE(16),
            height: bytes.readUInt32BE(20),
            hasAlpha: colorType === 4 || colorType === 6 || pngHasTransparency(bytes),
        }
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return inspectJpeg(bytes, filePath)
    }
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
        return inspectWebp(bytes, filePath)
    }
    throw new Error(`Unsupported image format: ${filePath}`)
}

function pngHasTransparency(bytes: Buffer) {
    let offset = 8
    while (offset + 8 <= bytes.length) {
        const length = bytes.readUInt32BE(offset)
        if (bytes.toString('ascii', offset + 4, offset + 8) === 'tRNS') return true
        offset += 12 + length
    }
    return false
}

function inspectJpeg(bytes: Buffer, filePath: string): ImageInfo {
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
    let offset = 2
    while (offset + 4 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1
            continue
        }
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
        if (offset >= bytes.length) break
        const marker = bytes[offset]
        offset += 1
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
        if (offset + 2 > bytes.length) break
        const segmentLength = bytes.readUInt16BE(offset)
        if (sofMarkers.has(marker) && offset + 7 <= bytes.length) {
            return {
                format: 'jpeg',
                width: bytes.readUInt16BE(offset + 5),
                height: bytes.readUInt16BE(offset + 3),
                hasAlpha: false,
            }
        }
        offset += segmentLength
    }
    throw new Error(`Unable to inspect JPEG dimensions: ${filePath}`)
}

function inspectWebp(bytes: Buffer, filePath: string): ImageInfo {
    let offset = 12
    while (offset + 8 <= bytes.length) {
        const chunkType = bytes.toString('ascii', offset, offset + 4)
        const chunkSize = bytes.readUInt32LE(offset + 4)
        const payload = offset + 8
        if (payload + chunkSize > bytes.length) break
        if (chunkType === 'VP8X' && chunkSize >= 10) {
            return {
                format: 'webp',
                width: bytes.readUIntLE(payload + 4, 3) + 1,
                height: bytes.readUIntLE(payload + 7, 3) + 1,
                hasAlpha: Boolean(bytes[payload] & 0x10),
            }
        }
        if (chunkType === 'VP8 ' && chunkSize >= 10) {
            return {
                format: 'webp',
                width: bytes.readUInt16LE(payload + 6) & 0x3fff,
                height: bytes.readUInt16LE(payload + 8) & 0x3fff,
                hasAlpha: false,
            }
        }
        if (chunkType === 'VP8L' && chunkSize >= 5) {
            const bits = bytes.readUInt32LE(payload + 1)
            return {
                format: 'webp',
                width: (bits & 0x3fff) + 1,
                height: ((bits >>> 14) & 0x3fff) + 1,
                hasAlpha: Boolean((bits >>> 28) & 1),
            }
        }
        offset = payload + chunkSize + (chunkSize % 2)
    }
    throw new Error(`Unable to inspect WebP dimensions: ${filePath}`)
}

function normalizeImageId(value: unknown, index: number) {
    const candidate = typeof value === 'string' ? value.trim().toLowerCase() : ''
    const normalized = candidate
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+|[._-]+$/g, '')
        .slice(0, 80)
    return normalized || `image-${index + 1}`
}

function requireObject(value: unknown, name: string): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`)
    return value as JsonObject
}

function requireNonEmptyString(value: unknown, name: string, maxLength: number) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`)
    const normalized = value.trim()
    if (normalized.length > maxLength) throw new Error(`${name} is too long.`)
    return normalized
}

function optionalString(value: unknown, name: string, maxLength: number): string | null {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string') throw new Error(`${name} must be a string.`)
    const normalized = value.trim()
    if (!normalized) return null
    if (normalized.length > maxLength) throw new Error(`${name} is too long.`)
    return normalized
}

function optionalInteger(
    value: unknown,
    name: string,
    minimum: number,
    maximum: number,
    fallback: number | null
) {
    if (value === undefined || value === null) return fallback
    if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
    }
    return Number(value)
}

function enumValue(
    value: unknown,
    name: string,
    allowed: Set<string>,
    fallback: string
) {
    if (value === undefined || value === null) return fallback
    if (typeof value !== 'string' || !allowed.has(value.toLowerCase())) {
        throw new Error(`${name} must be one of: ${[...allowed].join(', ')}.`)
    }
    return value.toLowerCase()
}

function nullableEnumValue(
    value: unknown,
    name: string,
    allowed: Set<string>,
    fallback: string | null
) {
    if (value === undefined || value === null || value === '') return fallback
    return enumValue(value, name, allowed, fallback ?? [...allowed][0])
}

function removeNullValues(input: JsonObject) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined))
}

function tryParseJson(value: string): JsonObject | null {
    try {
        return requireObject(JSON.parse(value), 'provider response')
    } catch {
        return null
    }
}

function providerErrorDetail(payload: JsonObject | null) {
    if (!payload) return ''
    const error = payload.error
    if (error && typeof error === 'object' && !Array.isArray(error)) {
        const message = (error as JsonObject).message
        if (typeof message === 'string') return message
    }
    return typeof payload.detail === 'string' ? payload.detail : ''
}

function mimeTypeForExtension(extension: string) {
    if (extension.toLowerCase() === '.png') return 'image/png'
    if (extension.toLowerCase() === '.webp') return 'image/webp'
    return 'image/jpeg'
}

function toPosixPath(value: string) {
    return value.split(path.sep).join('/')
}
