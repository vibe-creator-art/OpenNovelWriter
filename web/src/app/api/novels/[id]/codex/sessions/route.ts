import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import {
    DEFAULT_CODEX_REVIEW_LEVEL,
    DEFAULT_CODEX_REASONING_EFFORT,
    DEFAULT_CODEX_SERVICE_TIER,
    normalizeCodexReviewLevel,
    normalizeCodexReasoningEffort,
    normalizeCodexServiceTier,
    normalizeCodexSessionCategory,
    normalizeCodexString,
    normalizeCodexStringId,
    serializeCodexSession,
} from '@/lib/server/codex-session'
import { readCodexConnectionFiles } from '@/lib/server/codex-connection-storage'
import { DEFAULT_CODEX_MODEL, parseCodexModelFromConfig } from '@/lib/codex-config'
import { seedSkillSessionArtifact } from '@/lib/server/codex-skill-session'

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

export async function GET(request: NextRequest, { params }: RouteContext) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const novelId = await getRouteId(params)
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })
        if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

        const sessions = await prisma.codexSession.findMany({
            where: { novelId, ownerId: user.userId },
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        })

        return NextResponse.json({ sessions: sessions.map(serializeCodexSession) })
    } catch (error) {
        console.error('List Codex sessions error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const novelId = await getRouteId(params)
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })
        if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

        const body = await request.json().catch(() => null)
        const category = normalizeCodexSessionCategory(body?.category) ?? 'general'

        const activeConnection = await prisma.codexConnection.findFirst({
            where: { ownerId: user.userId, isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        })
        const activeConnectionModel = activeConnection
            ? parseCodexModelFromConfig(
                (await readCodexConnectionFiles(user.userId, activeConnection.id)).configToml,
                DEFAULT_CODEX_MODEL
            )
            : DEFAULT_CODEX_MODEL

        const now = new Date()
        const session = await prisma.codexSession.create({
            data: {
                id: normalizeCodexStringId(body?.id) ?? undefined,
                category,
                title: normalizeCodexStringId(body?.title),
                titleManuallyEdited: body?.titleManuallyEdited === true,
                reviewLevel: normalizeCodexReviewLevel(body?.reviewLevel) ?? DEFAULT_CODEX_REVIEW_LEVEL,
                modelId: normalizeCodexStringId(body?.modelId) ?? activeConnectionModel,
                reasoningEffort: normalizeCodexReasoningEffort(body?.reasoningEffort) ?? DEFAULT_CODEX_REASONING_EFFORT,
                serviceTier: normalizeCodexServiceTier(body?.serviceTier) ?? DEFAULT_CODEX_SERVICE_TIER,
                planMode: body?.planMode === true,
                draftContent: normalizeCodexString(body?.draftContent),
                codexConnectionId: activeConnection?.id ?? null,
                novelId,
                ownerId: user.userId,
                createdAt: now,
                updatedAt: now,
            },
        })

        if (category === 'scene_operation') {
            const skillId = normalizeCodexStringId(body?.skillId)
            const sceneId = normalizeCodexStringId(body?.sceneId)
            if (skillId && sceneId) {
                try {
                    await seedSkillSessionArtifact({
                        ownerId: user.userId,
                        novelId,
                        sessionId: session.id,
                        skillId,
                        sceneId,
                    })
                } catch (seedError) {
                    console.error('Seed scene-operation skill artifact error:', seedError)
                }
            }
        }

        if (category === 'scene_continuation') {
            const skillId = normalizeCodexStringId(body?.skillId)
            const sceneId = normalizeCodexStringId(body?.sceneId)
            const chapterId = normalizeCodexStringId(body?.chapterId)
            const panelId = normalizeCodexStringId(body?.panelId)
            const renderedBlocks = Array.isArray(body?.renderedBlocks)
                ? (body.renderedBlocks as unknown[])
                    .map((block) => {
                        const record = block as { role?: unknown; text?: unknown }
                        return typeof record?.role === 'string' && typeof record?.text === 'string'
                            ? { role: record.role, text: record.text }
                            : null
                    })
                    .filter((block): block is { role: string; text: string } => block !== null)
                : undefined

            if (skillId && sceneId && chapterId && panelId) {
                // Pair the inline panel with this session via a shared continuation draft, then
                // pre-assemble the author-resolved prompt into the session artifacts.
                try {
                    await prisma.sceneContinuationDraft.upsert({
                        where: { panelId },
                        create: { panelId, novelId, sceneId, chapterId, codexSessionId: session.id, skillId },
                        update: { codexSessionId: session.id, skillId, sceneId, chapterId },
                    })
                } catch (draftError) {
                    console.error('Create continuation draft error:', draftError)
                }
                try {
                    await seedSkillSessionArtifact({
                        ownerId: user.userId,
                        novelId,
                        sessionId: session.id,
                        skillId,
                        sceneId,
                        renderedBlocks,
                        panelId,
                    })
                } catch (seedError) {
                    console.error('Seed scene-continuation skill artifact error:', seedError)
                }
            }
        }

        return NextResponse.json({ session: serializeCodexSession(session) }, { status: 201 })
    } catch (error) {
        console.error('Create Codex session error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
