import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { scheduleImageGcSweep } from '@/lib/server/image-gc'
import {
    normalizeJsonString,
    normalizeString,
    normalizeStringId,
    serializeEditorChatConversation,
} from '@/lib/server/editor-chat'

interface RouteParams {
    params: Promise<{ id: string }>
}

async function findOwnedConversation(id: string, ownerId: string) {
    return prisma.editorChatConversation.findFirst({
        where: { id, ownerId },
        include: { messages: true },
    })
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const existing = await findOwnedConversation(id, user.userId)
        if (!existing) {
            return NextResponse.json({ detail: 'Chat not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => null)
        const data: Record<string, unknown> = {}

        if (Object.prototype.hasOwnProperty.call(body ?? {}, 'title')) {
            data.title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : null
        }
        if (typeof body?.titleManuallyEdited === 'boolean') {
            data.titleManuallyEdited = body.titleManuallyEdited
        }
        if (Object.prototype.hasOwnProperty.call(body ?? {}, 'promptId')) {
            data.promptId = normalizeStringId(body?.promptId)
        }
        if (Object.prototype.hasOwnProperty.call(body ?? {}, 'selectedGroupId')) {
            data.selectedGroupId = normalizeStringId(body?.selectedGroupId)
        }
        if (Object.prototype.hasOwnProperty.call(body ?? {}, 'draftContent')) {
            data.draftContent = normalizeString(body?.draftContent)
        }
        if (Object.prototype.hasOwnProperty.call(body ?? {}, 'promptSnapshot')) {
            data.promptSnapshotJson = normalizeJsonString(body?.promptSnapshot)
        }
        if (Object.prototype.hasOwnProperty.call(body ?? {}, 'inputState')) {
            data.inputStateJson = normalizeJsonString(body?.inputState)
        }

        if (Object.keys(data).length === 0) {
            return NextResponse.json({ conversation: serializeEditorChatConversation(existing) })
        }

        const conversation = await prisma.editorChatConversation.update({
            where: { id },
            data,
            include: { messages: true },
        })

        return NextResponse.json({ conversation: serializeEditorChatConversation(conversation) })
    } catch (error) {
        console.error('Update editor chat error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const existing = await findOwnedConversation(id, user.userId)
        if (!existing) {
            return NextResponse.json({ detail: 'Chat not found' }, { status: 404 })
        }

        await prisma.editorChatConversation.delete({ where: { id } })
        scheduleImageGcSweep()
        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Delete editor chat error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
