import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { serializeEditorChatConversation } from '@/lib/server/editor-chat'

interface RouteParams {
    params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const existing = await prisma.editorChatConversation.findFirst({
            where: { id, ownerId: user.userId },
            include: { messages: { orderBy: { createdAt: 'asc' } } },
        })

        if (!existing) {
            return NextResponse.json({ detail: 'Chat not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => null)
        const throughMessageId = typeof body?.throughMessageId === 'string' ? body.throughMessageId.trim() : ''
        const messages =
            throughMessageId.length > 0
                ? existing.messages.slice(
                      0,
                      Math.max(
                          0,
                          existing.messages.findIndex((message) => message.id === throughMessageId) + 1
                      )
                  )
                : existing.messages

        if (throughMessageId.length > 0 && messages.length === 0) {
            return NextResponse.json({ detail: 'Message not found' }, { status: 404 })
        }

        const now = new Date()
        const conversation = await prisma.editorChatConversation.create({
            data: {
                title: existing.title,
                titleManuallyEdited: existing.titleManuallyEdited,
                promptId: existing.promptId,
                selectedGroupId: existing.selectedGroupId,
                draftContent: existing.draftContent,
                promptSnapshotJson: existing.promptSnapshotJson,
                inputStateJson: existing.inputStateJson,
                novelId: existing.novelId,
                ownerId: existing.ownerId,
                createdAt: now,
                updatedAt: now,
                messages: {
                    create: messages.map((message, index) => ({
                        role: message.role,
                        content: message.content,
                        sentContent: message.sentContent,
                        fullRenderedContent: message.fullRenderedContent,
                        promptTokens: message.promptTokens,
                        completionTokens: message.completionTokens,
                        totalTokens: message.totalTokens,
                        termIdsJson: message.termIdsJson,
                        createdAt: new Date(now.getTime() + index),
                    })),
                },
            },
            include: { messages: true },
        })

        return NextResponse.json({ conversation: serializeEditorChatConversation(conversation) }, { status: 201 })
    } catch (error) {
        console.error('Clone editor chat error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
