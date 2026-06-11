import { prisma } from '@/lib/db'
import { getTermStateEntries } from '@/lib/term-state'
import {
    deleteImage,
    listUploadFiles,
    toManagedUploadUrl,
    UPLOADS_PUBLIC_PREFIX,
} from '@/lib/server/storage'

/**
 * Mark-and-sweep garbage collection for managed image files.
 *
 * The guarantee that uploads do not pile up forever lives HERE, not at delete
 * sites. Each feature that can reference an image registers a collector that
 * yields the managed URLs it currently points at. The sweep then deletes any
 * file on disk that no collector references (older than a grace window).
 *
 * When a new image-bearing feature lands (chat images, codex-generated
 * character art, etc.), add a collector below — that is the only wiring needed
 * for its files to be reclaimed.
 */

type UrlCollector = () => Promise<string[]>

const collectNovelCovers: UrlCollector = async () => {
    const rows = await prisma.novel.findMany({
        where: { coverImage: { startsWith: UPLOADS_PUBLIC_PREFIX } },
        select: { coverImage: true },
    })
    return rows.map((row) => toManagedUploadUrl(row.coverImage)).filter((url): url is string => url !== null)
}

// Keys inside a term entry that may hold a managed image URL.
const TERM_IMAGE_KEYS = ['avatar', 'image'] as const

const collectTermImages: UrlCollector = async () => {
    const rows = await prisma.novelTermState.findMany({ select: { stateJson: true } })
    const urls: string[] = []
    for (const row of rows) {
        let state: unknown
        try {
            state = JSON.parse(row.stateJson)
        } catch {
            continue
        }
        for (const entry of getTermStateEntries(state)) {
            for (const key of TERM_IMAGE_KEYS) {
                const url = toManagedUploadUrl(entry[key] as string | null | undefined)
                if (url) urls.push(url)
            }
            const gallery = entry.gallery
            if (!Array.isArray(gallery)) continue
            for (const item of gallery) {
                const raw = (item as { url?: unknown } | null)?.url
                const url = toManagedUploadUrl(typeof raw === 'string' ? raw : null)
                if (url) urls.push(url)
            }
        }
    }
    return urls
}

const collectChatImages: UrlCollector = async () => {
    const rows = await prisma.editorChatMessage.findMany({
        where: { attachmentsJson: { not: '[]' } },
        select: { attachmentsJson: true },
    })
    const urls: string[] = []
    for (const row of rows) {
        let attachments: unknown
        try {
            attachments = JSON.parse(row.attachmentsJson)
        } catch {
            continue
        }
        if (!Array.isArray(attachments)) continue
        for (const entry of attachments) {
            const url = toManagedUploadUrl(typeof entry === 'string' ? entry : null)
            if (url) urls.push(url)
        }
    }
    return urls
}

const collectCodexImages: UrlCollector = async () => {
    const rows = await prisma.codexSession.findMany({
        where: { messagesJson: { contains: UPLOADS_PUBLIC_PREFIX } },
        select: { messagesJson: true },
    })
    const urls: string[] = []
    for (const row of rows) {
        let messages: unknown
        try {
            messages = JSON.parse(row.messagesJson)
        } catch {
            continue
        }
        if (!Array.isArray(messages)) continue
        for (const message of messages) {
            const attachments = (message as { attachments?: unknown } | null)?.attachments
            if (!Array.isArray(attachments)) continue
            for (const entry of attachments) {
                const url = toManagedUploadUrl(typeof entry === 'string' ? entry : null)
                if (url) urls.push(url)
            }
        }
    }
    return urls
}

const COLLECTORS: UrlCollector[] = [collectNovelCovers, collectTermImages, collectChatImages, collectCodexImages]

/** Union of every managed image URL currently referenced anywhere. */
export async function collectReferencedImageUrls(): Promise<Set<string>> {
    const referenced = new Set<string>()
    const results = await Promise.all(COLLECTORS.map((collect) => collect()))
    for (const urls of results) {
        for (const url of urls) referenced.add(url)
    }
    return referenced
}

// Skip files touched within this window — they may be uploaded-but-not-yet-saved
// (e.g. a cover picked in a dialog the user hasn't submitted yet).
const DEFAULT_GRACE_MS = 60 * 60 * 1000 // 1 hour

export type SweepResult = { scanned: number; referenced: number; deleted: number }

// Debounce window for delete-triggered sweeps: lets a burst of deletions
// (multi-select, cascade) coalesce into one pass.
const SCHEDULED_SWEEP_DELAY_MS = 10 * 1000
let scheduledSweepTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Fire-and-forget sweep after an operation that drops image references
 * (deleting a chat, codex session, or messages). The periodic/startup sweep
 * remains the correctness backstop; this just makes reclamation prompt.
 */
export function scheduleImageGcSweep() {
    if (scheduledSweepTimer) return
    scheduledSweepTimer = setTimeout(() => {
        scheduledSweepTimer = null
        sweepOrphanImages()
            .then((result) => {
                if (result.deleted > 0) {
                    console.log(`[image-gc] swept ${result.deleted} orphan image(s) after delete`)
                }
            })
            .catch((error) => {
                console.error('[image-gc] scheduled sweep failed:', error)
            })
    }, SCHEDULED_SWEEP_DELAY_MS)
}

export async function sweepOrphanImages(options: { graceMs?: number } = {}): Promise<SweepResult> {
    const graceMs = options.graceMs ?? DEFAULT_GRACE_MS
    const now = Date.now()

    const [referenced, files] = await Promise.all([collectReferencedImageUrls(), listUploadFiles()])

    let deleted = 0
    for (const file of files) {
        if (referenced.has(file.url)) continue
        if (now - file.mtimeMs < graceMs) continue
        if (await deleteImage(file.url)) deleted++
    }

    return { scanned: files.length, referenced: referenced.size, deleted }
}
