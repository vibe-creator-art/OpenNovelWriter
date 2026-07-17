import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { scheduleImageGcSweep } from '@/lib/server/image-gc'
import { getPrismaClient } from '@/lib/db'
import { canUseCodexFastMode } from '@/lib/codex-config'
import {
    normalizeCodexReasoningEffort,
    normalizeCodexReviewLevel,
    normalizeCodexServiceTier,
    normalizeCodexString,
    normalizeCodexStringId,
    parseCodexDraftArtifacts,
    parseCodexDraftAttachments,
    serializeCodexSession,
} from '@/lib/server/codex-session'
import { deleteCodexSessionWorkspace } from '@/lib/server/codex-session-workspace'
import {
    rawDeleteContinuationDraft,
    stripContinuationPanelMarker,
} from '@/lib/server/continuation-draft'

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

export async function PATCH(request: NextRequest, { params }: RouteContext) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const id = await getRouteId(params)
        const existing = await prisma.codexSession.findFirst({
            where: { id, ownerId: user.userId },
            select: { id: true, codexConnectionId: true },
        })
        if (!existing) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })

        const body = await request.json().catch(() => null)
        const data: {
            title?: string | null
            titleManuallyEdited?: boolean
            reviewLevel?: string
            modelId?: string
            reasoningEffort?: string
            serviceTier?: string
            planMode?: boolean
            draftContent?: string
            draftAttachmentsJson?: string
            draftArtifactsJson?: string
            updatedAt: Date
        } = { updatedAt: new Date() }

        if (body && Object.hasOwn(body, 'title')) {
            data.title = normalizeCodexStringId(body.title)
        }
        if (body && Object.hasOwn(body, 'titleManuallyEdited')) {
            data.titleManuallyEdited = body.titleManuallyEdited === true
        }
        if (body && Object.hasOwn(body, 'reviewLevel')) {
            const reviewLevel = normalizeCodexReviewLevel(body.reviewLevel)
            if (!reviewLevel) {
                return NextResponse.json({ detail: 'Invalid Codex review level' }, { status: 400 })
            }
            data.reviewLevel = reviewLevel
        }
        if (body && Object.hasOwn(body, 'modelId')) {
            const modelId = normalizeCodexStringId(body.modelId)
            if (!modelId) {
                return NextResponse.json({ detail: 'Invalid Codex model' }, { status: 400 })
            }
            data.modelId = modelId
        }
        if (body && Object.hasOwn(body, 'reasoningEffort')) {
            const reasoningEffort = normalizeCodexReasoningEffort(body.reasoningEffort)
            if (!reasoningEffort) {
                return NextResponse.json({ detail: 'Invalid Codex reasoning effort' }, { status: 400 })
            }
            data.reasoningEffort = reasoningEffort
        }
        if (body && Object.hasOwn(body, 'serviceTier')) {
            const serviceTier = normalizeCodexServiceTier(body.serviceTier)
            if (!serviceTier) {
                return NextResponse.json({ detail: 'Invalid Codex service tier' }, { status: 400 })
            }
            if (serviceTier === 'fast') {
                const connection = existing.codexConnectionId
                    ? await prisma.codexConnection.findFirst({
                        where: { id: existing.codexConnectionId, ownerId: user.userId },
                        select: { providerType: true, authStatus: true, authType: true },
                    })
                    : await prisma.codexConnection.findFirst({
                        where: { ownerId: user.userId, isActive: true },
                        orderBy: { createdAt: 'asc' },
                        select: { providerType: true, authStatus: true, authType: true },
                    })
                if (!canUseCodexFastMode(connection)) {
                    return NextResponse.json(
                        { detail: 'Fast mode requires an authenticated ChatGPT Codex connection' },
                        { status: 400 }
                    )
                }
            }
            data.serviceTier = serviceTier
        }
        if (body && Object.hasOwn(body, 'planMode')) {
            data.planMode = body.planMode === true
        }
        if (body && Object.hasOwn(body, 'draftContent')) {
            data.draftContent = normalizeCodexString(body.draftContent)
        }
        if (body && Object.hasOwn(body, 'draftAttachments')) {
            data.draftAttachmentsJson = JSON.stringify(
                parseCodexDraftAttachments(JSON.stringify(body.draftAttachments))
            )
        }
        if (body && Object.hasOwn(body, 'draftArtifacts')) {
            data.draftArtifactsJson = JSON.stringify(
                parseCodexDraftArtifacts(JSON.stringify(body.draftArtifacts))
            )
        }

        const session = await prisma.codexSession.update({
            where: { id },
            data,
        })

        return NextResponse.json({ session: serializeCodexSession(session) })
    } catch (error) {
        console.error('Update Codex session error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const id = await getRouteId(params)
        const existing = await prisma.codexSession.findFirst({
            where: { id, ownerId: user.userId },
            select: { id: true, ownerId: true },
        })
        if (!existing) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })

        // A scene-continuation session is paired with an inline panel (one continuation draft
        // linked by codexSessionId). Deleting the session removes that entry point too: strip the
        // panel marker from the scene HTML (covers the editor-closed case) and delete the draft.
        // `removedPanelId` is returned so an open editor can drop the live node via a client event.
        const linkedDraft = await prisma.sceneContinuationDraft.findFirst({
            where: { codexSessionId: id },
            select: { panelId: true, sceneId: true },
        })
        if (linkedDraft) {
            await stripContinuationPanelMarker(linkedDraft.sceneId, linkedDraft.panelId)
            await rawDeleteContinuationDraft(linkedDraft.panelId)
        }

        // Deleting the session removes its chat-side review entry, so finalize (accept)
        // any of its still-pending manuscript edits — their content is already applied and
        // the author can no longer reach them from this session.
        await prisma.sceneEdit.updateMany({
            where: { sessionId: id, status: 'pending' },
            data: { status: 'accepted' },
        })

        await prisma.codexSession.delete({ where: { id } })
        await deleteCodexSessionWorkspace(existing.ownerId, existing.id)
        scheduleImageGcSweep()
        return NextResponse.json({ ok: true, removedPanelId: linkedDraft?.panelId ?? null })
    } catch (error) {
        console.error('Delete Codex session error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
