import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { acceptSceneEdit, rejectSceneEdit } from '@/lib/server/scene-edit-actions'

interface RouteParams {
    params: Promise<{ id: string; editId: string }>
}

// PATCH /api/novels/[id]/scene-edits/[editId] - body { action: 'accept' | 'reject' }
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { id: novelId, editId } = await params
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })
        if (!novel) return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })

        const body = await request.json().catch(() => ({}))
        const action = typeof body?.action === 'string' ? body.action : ''
        if (action !== 'accept' && action !== 'reject') {
            return NextResponse.json({ detail: 'Unsupported action' }, { status: 400 })
        }

        const result = action === 'accept'
            ? await acceptSceneEdit(user.userId, editId)
            : await rejectSceneEdit(user.userId, editId)

        if (!result.ok) {
            return NextResponse.json({ detail: result.error }, { status: result.status ?? 400 })
        }
        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Scene edit action error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
