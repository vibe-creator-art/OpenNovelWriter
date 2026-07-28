import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
    getOwnedContinuationDraft,
    rawDeleteContinuationDraft,
    serializeContinuationDraft,
} from '@/lib/server/continuation-draft'
import { deleteCodexSession } from '@/lib/server/codex-session-deletion'

interface RouteContext {
    params: Promise<{ panelId: string }>
}

function normalizeString(value: unknown) {
    return typeof value === 'string' ? value : ''
}

function normalizeUpdatedBy(value: unknown) {
    return value === 'codex' || value === 'model' || value === 'user' ? value : 'user'
}

export async function GET(request: NextRequest, { params }: RouteContext) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { panelId } = await params
        const draft = await getOwnedContinuationDraft(user.userId, panelId)
        return NextResponse.json({ draft: draft ? serializeContinuationDraft(draft) : null })
    } catch (error) {
        console.error('Get continuation draft error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { panelId } = await params
        if (!panelId.trim()) return NextResponse.json({ detail: 'panelId is required' }, { status: 400 })

        const body = await request.json().catch(() => null)
        const novelId = normalizeString(body?.novelId).trim()
        const sceneId = normalizeString(body?.sceneId).trim()
        const chapterId = normalizeString(body?.chapterId).trim()
        if (!novelId || !sceneId || !chapterId) {
            return NextResponse.json({ detail: 'novelId, sceneId and chapterId are required' }, { status: 400 })
        }

        const novel = await prisma.novel.findFirst({ where: { id: novelId, ownerId: user.userId }, select: { id: true } })
        if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

        const content = normalizeString(body?.content)
        const planning = normalizeString(body?.planning)
        const updatedBy = normalizeUpdatedBy(body?.updatedBy)
        const codexSessionId = normalizeString(body?.codexSessionId).trim() || null
        const skillId = normalizeString(body?.skillId).trim() || null

        const draft = await prisma.sceneContinuationDraft.upsert({
            where: { panelId },
            create: { panelId, novelId, sceneId, chapterId, codexSessionId, skillId, content, planning, updatedBy },
            update: {
                content,
                planning,
                updatedBy,
                // Keep the panel anchored to its scene/chapter; only set session/skill links when provided.
                ...(codexSessionId ? { codexSessionId } : {}),
                ...(skillId ? { skillId } : {}),
            },
        })

        return NextResponse.json({ draft: serializeContinuationDraft(draft) })
    } catch (error) {
        console.error('Save continuation draft error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { panelId } = await params
        const draft = await getOwnedContinuationDraft(user.userId, panelId)

        // Tear down the paired Codex session before removing the shared draft.
        if (draft?.codexSessionId) {
            await deleteCodexSession(user.userId, draft.codexSessionId)
        }
        await rawDeleteContinuationDraft(panelId)
        return NextResponse.json({ ok: true, deletedCodexSessionId: draft?.codexSessionId ?? null })
    } catch (error) {
        console.error('Delete continuation draft error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
