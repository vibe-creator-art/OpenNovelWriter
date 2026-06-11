import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import {
    normalizeJsonString,
    normalizeString,
    normalizeStringId,
    serializeEditorChatConversation,
} from '@/lib/server/editor-chat'

interface RouteParams {
    params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const conversations = await prisma.editorChatConversation.findMany({
            where: { novelId, ownerId: user.userId },
            include: { messages: true },
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        })

        return NextResponse.json({ conversations: conversations.map(serializeEditorChatConversation) })
    } catch (error) {
        console.error('List editor chats error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: novelId } = await params
        const novel = await prisma.novel.findFirst({
            where: { id: novelId, ownerId: user.userId },
            select: { id: true },
        })

        if (!novel) {
            return NextResponse.json({ detail: 'Novel not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => null)
        const id = normalizeStringId(body?.id) ?? undefined
        const now = new Date()

        const conversation = await prisma.editorChatConversation.create({
            data: {
                ...(id ? { id } : {}),
                title: typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : null,
                titleManuallyEdited: body?.titleManuallyEdited === true,
                promptId: normalizeStringId(body?.promptId),
                selectedGroupId: normalizeStringId(body?.selectedGroupId),
                draftContent: normalizeString(body?.draftContent),
                promptSnapshotJson: normalizeJsonString(body?.promptSnapshot),
                inputStateJson: normalizeJsonString(body?.inputState),
                novelId,
                ownerId: user.userId,
                createdAt: now,
                updatedAt: now,
            },
            include: { messages: true },
        })

        return NextResponse.json({ conversation: serializeEditorChatConversation(conversation) }, { status: 201 })
    } catch (error) {
        console.error('Create editor chat error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
