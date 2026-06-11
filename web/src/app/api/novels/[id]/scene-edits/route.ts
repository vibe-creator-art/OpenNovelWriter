import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { rejectSceneEdit, type SceneEditRecord } from '@/lib/server/scene-edit-actions'

interface RouteParams {
    params: Promise<{ id: string }>
}

const EDIT_FIELDS = {
    id: true,
    novelId: true,
    sceneId: true,
    chapterId: true,
    actNumber: true,
    beforeText: true,
    afterText: true,
    anchorHash: true,
    status: true,
    createdAt: true,
} as const

// GET /api/novels/[id]/scene-edits?status=pending - list AI manuscript edits for review
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { id: novelId } = await params
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })
        if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

        const status = request.nextUrl.searchParams.get('status') ?? 'pending'
        const edits = await prisma.sceneEdit.findMany({
            where: { novelId, ...(status === 'all' ? {} : { status }) },
            orderBy: [{ createdAt: 'desc' }],
            select: EDIT_FIELDS,
        })

        return NextResponse.json(edits)
    } catch (error) {
        console.error('List scene edits error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/novels/[id]/scene-edits - bulk { action: 'accept-all' | 'reject-all', sceneId? }
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { id: novelId } = await params
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })
        if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

        const body = await request.json().catch(() => ({}))
        const action = typeof body?.action === 'string' ? body.action : ''
        const sceneId = typeof body?.sceneId === 'string' ? body.sceneId : undefined

        if (action !== 'accept-all' && action !== 'reject-all') {
            return NextResponse.json({ detail: 'Unsupported action' }, { status: 400 })
        }

        const pending = await prisma.sceneEdit.findMany({
            where: { novelId, status: 'pending', ...(sceneId ? { sceneId } : {}) },
            orderBy: [{ createdAt: 'desc' }],
            select: EDIT_FIELDS,
        })

        let accepted = 0
        const failed: { id: string; error: string }[] = []

        if (action === 'accept-all') {
            const ids = pending.map((edit) => edit.id)
            if (ids.length > 0) {
                await prisma.sceneEdit.updateMany({ where: { id: { in: ids } }, data: { status: 'accepted' } })
            }
            accepted = ids.length
        } else {
            // Reject newest-first so later edits unwind before earlier ones (better revert success).
            for (const edit of pending) {
                const result = await rejectSceneEdit(user.userId, edit as SceneEditRecord)
                if (result.ok) accepted += 1
                else failed.push({ id: edit.id, error: result.error })
            }
        }

        return NextResponse.json({ ok: true, processed: accepted, failed })
    } catch (error) {
        console.error('Bulk scene edit action error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
