import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { normalizeString, normalizeStringId, serializeEditorChatConversation } from '@/lib/server/editor-chat'
import { extractInlineImagesToUploads, normalizeManagedAttachmentUrls } from '@/lib/server/storage'
import { scheduleImageGcSweep } from '@/lib/server/image-gc'

interface RouteParams {
    params: Promise<{ id: string }>
}

function normalizeRole(value: unknown) {
    return value === 'user' || value === 'assistant' ? value : null
}

function normalizeTermIds(value: unknown) {
    if (!Array.isArray(value)) return []

    const out: string[] = []
    const seen = new Set<string>()
    for (const item of value) {
        const normalized = typeof item === 'string' ? item.trim() : ''
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        out.push(normalized)
    }
    return out
}

function normalizeTokenCount(value: unknown) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
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

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: conversationId } = await params
        const existing = await prisma.editorChatConversation.findFirst({
            where: { id: conversationId, ownerId: user.userId },
            include: { messages: true },
        })

        if (!existing) {
            return NextResponse.json({ detail: 'Chat not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => null)
        const role = normalizeRole(body?.role)
        if (!role) {
            return NextResponse.json({ detail: 'Invalid message role' }, { status: 400 })
        }

        let content = normalizeString(body?.content)
        const attachments = normalizeManagedAttachmentUrls(body?.attachments)
        // A reply from an image-output model can carry generated images inline as
        // base64 data URIs; persist them as managed uploads and keep only the URLs.
        if (role === 'assistant') {
            const extracted = await extractInlineImagesToUploads(content)
            content = extracted.content
            for (const url of extracted.urls) {
                if (!attachments.includes(url)) attachments.push(url)
            }
        }
        const termIds = normalizeTermIds(body?.termIds)
        const id = normalizeStringId(body?.id) ?? undefined
        const now = new Date()

        const nextMessages = [
            ...existing.messages.map((message) => ({ role: message.role, content: message.content })),
            { role, content },
        ]
        const title = existing.titleManuallyEdited ? existing.title : toConversationTitle(nextMessages)

        const conversation = await prisma.$transaction(async (tx) => {
            await tx.editorChatMessage.create({
                data: {
                    ...(id ? { id } : {}),
                    conversationId,
                    role,
                    content,
                    sentContent: typeof body?.sentContent === 'string' ? body.sentContent : null,
                    fullRenderedContent:
                        typeof body?.fullRenderedContent === 'string' ? body.fullRenderedContent : null,
                    promptTokens: normalizeTokenCount(body?.promptTokens),
                    completionTokens: normalizeTokenCount(body?.completionTokens),
                    totalTokens: normalizeTokenCount(body?.totalTokens),
                    termIdsJson: JSON.stringify(termIds),
                    attachmentsJson: JSON.stringify(attachments),
                    createdAt: now,
                },
            })

            return tx.editorChatConversation.update({
                where: { id: conversationId },
                data: {
                    title,
                    draftContent: '',
                    updatedAt: now,
                },
                include: { messages: true },
            })
        })

        return NextResponse.json({ conversation: serializeEditorChatConversation(conversation) }, { status: 201 })
    } catch (error) {
        console.error('Create editor chat message error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id: conversationId } = await params
        const existing = await prisma.editorChatConversation.findFirst({
            where: { id: conversationId, ownerId: user.userId },
            include: { messages: { orderBy: { createdAt: 'asc' } } },
        })

        if (!existing) {
            return NextResponse.json({ detail: 'Chat not found' }, { status: 404 })
        }

        const body = await request.json().catch(() => null)
        const ids = Array.isArray(body?.messageIds)
            ? body.messageIds
                  .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
                  .filter(Boolean)
            : []
        const idSet = new Set(ids)
        if (idSet.size === 0) {
            return NextResponse.json({ detail: 'No message ids provided' }, { status: 400 })
        }

        const ownedIds = existing.messages.map((message) => message.id).filter((id) => idSet.has(id))
        if (ownedIds.length === 0) {
            return NextResponse.json({ detail: 'Messages not found' }, { status: 404 })
        }

        const remainingMessages = existing.messages
            .filter((message) => !idSet.has(message.id))
            .map((message) => ({ role: message.role, content: message.content }))
        const now = new Date()
        const title = existing.titleManuallyEdited ? existing.title : toConversationTitle(remainingMessages)

        const conversation = await prisma.$transaction(async (tx) => {
            await tx.editorChatMessage.deleteMany({
                where: { conversationId, id: { in: ownedIds } },
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

        scheduleImageGcSweep()
        return NextResponse.json({ conversation: serializeEditorChatConversation(conversation) })
    } catch (error) {
        console.error('Delete editor chat messages error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
