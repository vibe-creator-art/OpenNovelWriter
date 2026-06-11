import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { normalizeString, serializeEditorChatConversation } from '@/lib/server/editor-chat'

interface RouteParams {
    params: Promise<{ id: string; messageId: string }>
}

function toConversationTitle(messages: Array<{ role: string; content: string }>) {
    const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim())
    if (!firstUserMessage) return null

    const normalized = firstUserMessage.content.trim().replace(/\s+/g, ' ')
    const firstLine = normalized.split(/\r?\n/u)[0] ?? normalized
    const sentenceMatch = firstLine.match(/^(.+?[。！？!?\.])(?:\s|$)/u)
    const baseTitle = (sentenceMatch?.[1] ?? firstLine).trim()
    if (!baseTitle) return null
    if (baseTitle.length <= 28) return baseTitle
    return `${baseTitle.slice(0, 28).trimEnd()}...`
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: conversationId, messageId } = await params
        const existing = await prisma.editorChatConversation.findFirst({
            where: { id: conversationId, ownerId: user.userId },
            include: { messages: { orderBy: { createdAt: 'asc' } } },
        })

        if (!existing) {
            return NextResponse.json({ detail: 'Chat not found' }, { status: 404 })
        }

        const target = existing.messages.find((message) => message.id === messageId) ?? null
        if (!target) {
            return NextResponse.json({ detail: 'Message not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => null)
        const content = normalizeString(body?.content)
        const nextMessages = existing.messages.map((message) => ({
            role: message.role,
            content: message.id === messageId ? content : message.content,
        }))
        const title = existing.titleManuallyEdited ? existing.title : toConversationTitle(nextMessages)
        const now = new Date()

        const conversation = await prisma.$transaction(async (tx) => {
            await tx.editorChatMessage.update({
                where: { id: messageId },
                data: { content },
            })

            return tx.editorChatConversation.update({
                where: { id: conversationId },
                data: {
                    title,
                    updatedAt: now,
                },
                include: { messages: true },
            })
        })

        return NextResponse.json({ conversation: serializeEditorChatConversation(conversation) })
    } catch (error) {
        console.error('Update editor chat message error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
