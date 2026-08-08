import fs from 'fs/promises'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { getCodexSessionWorkspacePath } from '@/lib/server/codex-session-workspace'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
    params: Promise<unknown>
}

const prisma = getPrismaClient({ ensureModel: 'codexSession' })
const IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.webp'])

async function getRouteId(params: Promise<unknown>) {
    const resolved = await params
    return typeof resolved === 'object' && resolved !== null && typeof (resolved as { id?: unknown }).id === 'string'
        ? (resolved as { id: string }).id
        : ''
}

export async function GET(request: NextRequest, { params }: RouteContext) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const sessionId = await getRouteId(params)
    const session = await prisma.codexSession.findFirst({
        where: { id: sessionId, ownerId: user.userId },
        select: { id: true },
    })
    if (!session) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })

    const artifactsRoot = path.join(getCodexSessionWorkspacePath(user.userId, sessionId), 'artifacts')
    const rawPath = request.nextUrl.searchParams.get('path') ?? ''
    const resolved = await resolveArtifactPath(artifactsRoot, rawPath)
    if (!resolved) return NextResponse.json({ detail: 'Invalid image artifact path' }, { status: 400 })

    const extension = path.extname(resolved.realPath).toLowerCase()
    if (extension === '.json') {
        return readManifest(artifactsRoot, resolved.realPath)
    }
    if (!IMAGE_EXTENSIONS.has(extension)) {
        return NextResponse.json({ detail: 'Unsupported image artifact type' }, { status: 400 })
    }

    try {
        const bytes = await fs.readFile(resolved.realPath)
        return new NextResponse(new Uint8Array(bytes), {
            headers: {
                'Cache-Control': 'private, no-store',
                'Content-Type': mimeType(extension),
                'Content-Disposition': `inline; filename="${path.basename(resolved.realPath).replace(/"/g, '')}"`,
            },
        })
    } catch {
        return NextResponse.json({ detail: 'Image artifact not found' }, { status: 404 })
    }
}

async function readManifest(artifactsRoot: string, manifestPath: string) {
    let parsed: unknown
    try {
        parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    } catch {
        return NextResponse.json({ detail: 'Image manifest not found or invalid' }, { status: 404 })
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ detail: 'Invalid image manifest' }, { status: 400 })
    }
    const manifest = parsed as Record<string, unknown>
    if (!Array.isArray(manifest.items) || manifest.items.length === 0 || manifest.items.length > 64) {
        return NextResponse.json({ detail: 'Invalid image manifest items' }, { status: 400 })
    }

    const items = []
    const seenIds = new Set<string>()
    for (const rawItem of manifest.items) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue
        const item = rawItem as Record<string, unknown>
        const id = typeof item.id === 'string' ? item.id.trim() : ''
        const file = typeof item.file === 'string' ? item.file.trim() : ''
        if (!id || seenIds.has(id) || !file) continue
        const imagePath = await resolveArtifactPath(artifactsRoot, path.resolve(path.dirname(manifestPath), file))
        if (!imagePath || !IMAGE_EXTENSIONS.has(path.extname(imagePath.realPath).toLowerCase())) continue
        seenIds.add(id)
        items.push({
            id,
            label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : id,
            path: imagePath.artifactPath,
            prompt: typeof item.prompt === 'string' ? item.prompt : '',
            revisedPrompt: typeof item.revisedPrompt === 'string' ? item.revisedPrompt : null,
        })
    }
    if (items.length === 0) {
        return NextResponse.json({ detail: 'Image manifest contains no readable images' }, { status: 404 })
    }

    return NextResponse.json(
        {
            ok: true,
            title: typeof manifest.title === 'string' && manifest.title.trim() ? manifest.title.trim() : 'Generated images',
            model: typeof manifest.model === 'string' ? manifest.model : '',
            items,
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
    )
}

async function resolveArtifactPath(artifactsRoot: string, rawPath: string) {
    const trimmed = rawPath.trim()
    if (!trimmed) return null
    const root = await fs.realpath(artifactsRoot).catch(() => null)
    if (!root) return null
    const candidate = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed)
    const realPath = await fs.realpath(candidate).catch(() => null)
    if (!realPath) return null
    const relative = path.relative(root, realPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
    return { realPath, artifactPath: relative.split(path.sep).join('/') }
}

function mimeType(extension: string) {
    if (extension === '.png') return 'image/png'
    if (extension === '.webp') return 'image/webp'
    return 'image/jpeg'
}
