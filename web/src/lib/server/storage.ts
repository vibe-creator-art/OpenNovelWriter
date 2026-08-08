import { mkdir, writeFile, rm, stat, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, join } from 'path'

/**
 * Unified image storage adapter.
 *
 * Novel covers, term images, chat attachments, and Codex generated images share this storage boundary.
 *
 * The backend is the local `public/uploads` directory and orphan files are reclaimed by `image-gc.ts`.
 */

export const UPLOADS_PUBLIC_PREFIX = '/uploads/'
const UPLOADS_DIR = join(process.cwd(), 'public', 'uploads')
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

function stripUrlSuffixes(value: string) {
    return value.split('#', 1)[0]?.split('?', 1)[0] ?? value
}

/** Absolute disk path for a managed upload URL, or null if not managed. */
export function resolveManagedUploadPath(uploadUrl: string) {
    const pathname = stripUrlSuffixes(uploadUrl)
    if (!pathname.startsWith(UPLOADS_PUBLIC_PREFIX)) return null

    const relativePath = pathname.slice(UPLOADS_PUBLIC_PREFIX.length)
    if (!relativePath) return null

    const filename = basename(relativePath)
    if (filename !== relativePath) return null

    return join(UPLOADS_DIR, filename)
}

/** True when `value` is a URL this module owns (a `/uploads/...` file). */
export function isManagedUploadUrl(value: string | null | undefined): value is string {
    return typeof value === 'string' && resolveManagedUploadPath(value) !== null
}

/** Canonical `/uploads/<filename>` form (strips query/hash), or null if not managed. */
export function toManagedUploadUrl(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null
    const filepath = resolveManagedUploadPath(value)
    if (!filepath) return null
    return `${UPLOADS_PUBLIC_PREFIX}${basename(filepath)}`
}

/**
 * Normalize a client-provided attachment list into canonical managed URLs.
 * Anything that is not a managed `/uploads/...` URL is dropped — attachments
 * always come from our own upload endpoint.
 */
export function normalizeManagedAttachmentUrls(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of value) {
        const url = toManagedUploadUrl(typeof item === 'string' ? item : null)
        if (!url || seen.has(url)) continue
        seen.add(url)
        out.push(url)
    }
    return out
}

function mimeToExt(mime: string) {
    const m = mime.toLowerCase()
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
    if (m.includes('png')) return 'png'
    if (m.includes('gif')) return 'gif'
    if (m.includes('webp')) return 'webp'
    return 'png'
}

async function ensureUploadsDir() {
    if (!existsSync(UPLOADS_DIR)) {
        await mkdir(UPLOADS_DIR, { recursive: true })
    }
}

function randomFilename(ext: string) {
    const safeExt = ALLOWED_EXTENSIONS.has(ext.toLowerCase()) ? ext.toLowerCase() : 'png'
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${safeExt}`
}

export type SavedImage = { url: string; filename: string }

/** Persist raw bytes and return a stable managed URL. */
export async function saveImageBuffer(buffer: Buffer, ext: string): Promise<SavedImage> {
    await ensureUploadsDir()
    const filename = randomFilename(ext)
    await writeFile(join(UPLOADS_DIR, filename), buffer)
    return { url: `${UPLOADS_PUBLIC_PREFIX}${filename}`, filename }
}

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/

/** Persist a `data:image/...;base64,...` URL as a file. */
export async function saveImageDataUrl(dataUrl: string): Promise<SavedImage> {
    const match = DATA_URL_RE.exec(dataUrl.trim())
    if (!match) throw new Error('Invalid image data URL')
    const buffer = Buffer.from(match[2], 'base64')
    return saveImageBuffer(buffer, mimeToExt(match[1]))
}

/**
 * Turn any image reference into a stable managed URL.
 * - already-managed URL: returned untouched
 * - `data:` URL: decoded and persisted
 * - remote URL (e.g. a model's temporary image URL that will expire): downloaded
 *   and persisted now, so the reference we keep never goes dead.
 */
export async function persistExternalImage(sourceUrl: string): Promise<SavedImage> {
    const managed = toManagedUploadUrl(sourceUrl)
    if (managed) return { url: managed, filename: basename(managed) }
    if (sourceUrl.startsWith('data:')) return saveImageDataUrl(sourceUrl)

    const res = await fetch(sourceUrl)
    if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${sourceUrl}`)
    const contentType = res.headers.get('content-type') || 'image/png'
    const buffer = Buffer.from(await res.arrayBuffer())
    return saveImageBuffer(buffer, mimeToExt(contentType))
}

/** Best-effort immediate deletion. Not required for correctness (GC backstops). */
export async function deleteImage(uploadUrl: string): Promise<boolean> {
    const filepath = resolveManagedUploadPath(uploadUrl)
    if (!filepath) return false
    await rm(filepath, { force: true })
    return true
}

export type UploadFileInfo = { url: string; filename: string; mtimeMs: number }

/** List every file currently in the uploads directory (canonical URLs). */
export async function listUploadFiles(): Promise<UploadFileInfo[]> {
    if (!existsSync(UPLOADS_DIR)) return []
    const names = await readdir(UPLOADS_DIR)
    const files: UploadFileInfo[] = []
    for (const name of names) {
        try {
            const info = await stat(join(UPLOADS_DIR, name))
            if (info.isFile()) {
                files.push({ url: `${UPLOADS_PUBLIC_PREFIX}${name}`, filename: name, mtimeMs: info.mtimeMs })
            }
        } catch {
            // file vanished between readdir and stat — ignore
        }
    }
    return files
}
