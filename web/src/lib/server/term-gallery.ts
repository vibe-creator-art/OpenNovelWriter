import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'

import { prisma } from '@/lib/db'
import { getCodexSessionWorkspacePath } from '@/lib/server/codex-session-workspace'
import { deleteImage, saveImageBuffer } from '@/lib/server/storage'
import { getTermStateEntries } from '@/lib/term-state'

export type TermGalleryItem = { id: string; url: string }

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.gif', '.webp'])

export class TermGalleryError extends Error {
    constructor(message: string, readonly status: number) {
        super(message)
    }
}

export function isImportableTermGalleryUrl(url: string) {
    return url.startsWith('/uploads/') || url.startsWith('http://') || url.startsWith('https://')
}

export function appendTermGalleryItem(state: unknown, termId: string, url: string) {
    const entries = getTermStateEntries(state)
    const entry = entries.find((candidate) => candidate.id === termId)
    if (!entry) throw new TermGalleryError('Term entry not found', 404)

    const gallery: TermGalleryItem[] = Array.isArray(entry.gallery)
        ? entry.gallery.filter(
            (item): item is TermGalleryItem =>
                Boolean(item)
                && typeof item === 'object'
                && typeof (item as { id?: unknown }).id === 'string'
                && typeof (item as { url?: unknown }).url === 'string'
        )
        : []
    if (gallery.some((item) => item.url === url)) return { gallery, changed: false }

    gallery.push({ id: randomUUID(), url })
    entry.gallery = gallery
    return { gallery, changed: true }
}

export async function appendTermGalleryImage(input: {
    ownerId: string
    novelId: string
    termId: string
    url: string
}) {
    const novel = await prisma.novel.findFirst({
        where: { id: input.novelId, ownerId: input.ownerId },
        select: { id: true },
    })
    if (!novel) throw new TermGalleryError('Novel not found', 404)

    const record = await prisma.novelTermState.findUnique({
        where: { novelId: input.novelId },
        select: { stateJson: true },
    })
    let state: unknown = null
    try {
        state = record ? JSON.parse(record.stateJson) : null
    } catch {
        state = null
    }
    const { gallery, changed } = appendTermGalleryItem(state, input.termId, input.url)
    if (changed) {
        await prisma.novelTermState.update({
            where: { novelId: input.novelId },
            data: { stateJson: JSON.stringify(state) },
        })
    }

    return gallery
}

export async function resolveCodexArtifactGalleryImage(artifactsRoot: string, imagePath: string) {
    const realRoot = await fs.realpath(artifactsRoot).catch(() => null)
    if (!realRoot) throw new TermGalleryError('Image artifact not found', 404)

    const candidate = path.isAbsolute(imagePath)
        ? path.resolve(imagePath)
        : path.resolve(realRoot, imagePath)
    const realImagePath = await fs.realpath(candidate).catch(() => null)
    if (!realImagePath) throw new TermGalleryError('Image artifact not found', 404)

    const relative = path.relative(realRoot, realImagePath)
    const extension = path.extname(realImagePath).toLowerCase()
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !IMAGE_EXTENSIONS.has(extension)) {
        throw new TermGalleryError('Image must be a supported file inside this Codex session artifacts directory', 400)
    }

    const stat = await fs.stat(realImagePath).catch(() => null)
    if (!stat) throw new TermGalleryError('Image artifact not found', 404)
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) {
        throw new TermGalleryError('Image must be a file no larger than 5 MB', 400)
    }

    return { realImagePath, extension }
}

export async function appendCodexArtifactToTermGallery(input: {
    ownerId: string
    sessionId: string
    novelId: string
    termId: string
    imagePath: string
}) {
    const session = await prisma.codexSession.findFirst({
        where: { id: input.sessionId, ownerId: input.ownerId, novelId: input.novelId },
        select: { id: true },
    })
    if (!session) throw new TermGalleryError('Codex session not found', 404)

    const artifactsRoot = path.join(getCodexSessionWorkspacePath(input.ownerId, input.sessionId), 'artifacts')
    const { realImagePath, extension } = await resolveCodexArtifactGalleryImage(artifactsRoot, input.imagePath)

    const saved = await saveImageBuffer(await fs.readFile(realImagePath), extension.slice(1))
    try {
        const gallery = await appendTermGalleryImage({
            ownerId: input.ownerId,
            novelId: input.novelId,
            termId: input.termId,
            url: saved.url,
        })
        return { image: saved, gallery }
    } catch (error) {
        await deleteImage(saved.url).catch(() => false)
        throw error
    }
}
