import fs from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { getCodexSessionWorkspacePath } from '@/lib/server/codex-session-workspace'
import { getAssistantBlock, parseLlmConversation } from '@/lib/server/llm-conversation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteContext {
    params: Promise<unknown>
}

const prisma = getPrismaClient({ ensureModel: 'codexSession' })

async function getRouteId(params: Promise<unknown>) {
    const resolved = await params
    return typeof resolved === 'object' && resolved !== null && typeof (resolved as { id?: unknown }).id === 'string'
        ? (resolved as { id: string }).id
        : ''
}

/**
 * Read a single assistant turn from a Codex session LLM-conversation artifact.
 * Backs the inline `[label](llm:<relPath>#<index>)` references emitted by run_llm,
 * so the front-end can render the model reply without Codex retyping it.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const sessionId = await getRouteId(params)
    const session = await prisma.codexSession.findFirst({
        where: { id: sessionId, ownerId: user.userId },
        select: { id: true },
    })
    if (!session) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })

    const rawPath = request.nextUrl.searchParams.get('path') ?? ''
    const indexParam = request.nextUrl.searchParams.get('index')
    const index = indexParam !== null && /^-?\d+$/.test(indexParam) ? Number(indexParam) : -1

    const resolved = await resolveArtifactPath(user.userId, sessionId, rawPath)
    if (!resolved) {
        return NextResponse.json({ detail: 'Invalid artifact path' }, { status: 400 })
    }

    let markdown: string
    try {
        markdown = await fs.readFile(resolved, 'utf8')
    } catch {
        return NextResponse.json({ detail: 'Artifact not found' }, { status: 404 })
    }

    const blocks = parseLlmConversation(markdown)
    const block = getAssistantBlock(blocks, index)
    if (!block) {
        return NextResponse.json({ detail: 'No assistant reply at that index' }, { status: 404 })
    }

    return NextResponse.json(
        { ok: true, content: block.content, index: block.index, total: block.total },
        { headers: { 'Cache-Control': 'no-store' } }
    )
}

async function resolveArtifactPath(ownerId: string, sessionId: string, rawPath: string) {
    const trimmed = rawPath.trim()
    if (!trimmed || path.isAbsolute(trimmed) || path.extname(trimmed).toLowerCase() !== '.md') return null

    const artifactsRoot = path.join(getCodexSessionWorkspacePath(ownerId, sessionId), 'artifacts')
    const target = path.resolve(artifactsRoot, trimmed)
    const relative = path.relative(artifactsRoot, target)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null

    return target
}
