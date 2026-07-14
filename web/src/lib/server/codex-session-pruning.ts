import { prisma } from '@/lib/db'
import { MIN_CODEX_SESSION_RETENTION_LIMIT } from '@/lib/codex-session-retention'
import { scheduleImageGcSweep } from '@/lib/server/image-gc'
import { type CodexSessionCategory } from '@/lib/server/codex-session'
import { deleteCodexSessionWorkspace } from '@/lib/server/codex-session-workspace'

export type CodexSessionCleanupResult = {
    deletedSessionIds: string[]
}

export async function pruneCodexSessionsForCategory(input: {
    ownerId: string
    novelId: string
    category: CodexSessionCategory
    retentionLimit: number
}): Promise<CodexSessionCleanupResult> {
    if (!Number.isInteger(input.retentionLimit) || input.retentionLimit < MIN_CODEX_SESSION_RETENTION_LIMIT) {
        throw new Error(`Codex session retention limit must be at least ${MIN_CODEX_SESSION_RETENTION_LIMIT}.`)
    }

    const [sessions, continuationDrafts, pendingEdits] = await Promise.all([
        prisma.codexSession.findMany({
            where: {
                ownerId: input.ownerId,
                novelId: input.novelId,
                category: input.category,
                status: { not: 'running' },
            },
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true },
        }),
        prisma.sceneContinuationDraft.findMany({
            where: { novelId: input.novelId, codexSessionId: { not: null } },
            select: { codexSessionId: true },
        }),
        prisma.sceneEdit.findMany({
            where: { novelId: input.novelId, status: 'pending', sessionId: { not: null } },
            select: { sessionId: true },
        }),
    ])

    const protectedSessionIds = new Set<string>()
    continuationDrafts.forEach((draft) => {
        if (draft.codexSessionId) protectedSessionIds.add(draft.codexSessionId)
    })
    pendingEdits.forEach((edit) => {
        if (edit.sessionId) protectedSessionIds.add(edit.sessionId)
    })

    const excessSessions = sessions
        .filter((session) => !protectedSessionIds.has(session.id))
        .slice(input.retentionLimit)
    if (excessSessions.length === 0) return { deletedSessionIds: [] }

    const deletedSessionIds: string[] = []
    for (const session of excessSessions) {
        const deleted = await prisma.$transaction(async (tx) => {
            const current = await tx.codexSession.findFirst({
                where: {
                    id: session.id,
                    ownerId: input.ownerId,
                    novelId: input.novelId,
                    category: input.category,
                    status: { not: 'running' },
                },
                select: { id: true },
            })
            if (!current) return false

            const linkedDraft = await tx.sceneContinuationDraft.findFirst({
                where: { codexSessionId: session.id },
                select: { panelId: true },
            })
            if (linkedDraft) return false

            const pendingEdit = await tx.sceneEdit.findFirst({
                where: { sessionId: session.id, status: 'pending' },
                select: { id: true },
            })
            if (pendingEdit) return false

            await tx.codexSession.delete({ where: { id: session.id } })
            return true
        })
        if (!deleted) continue

        deletedSessionIds.push(session.id)
        await deleteCodexSessionWorkspace(input.ownerId, session.id).catch((error) => {
            console.error(`Failed to delete pruned Codex session workspace ${session.id}:`, error)
        })
    }

    if (deletedSessionIds.length > 0) scheduleImageGcSweep()
    return { deletedSessionIds }
}
