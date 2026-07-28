import { prisma } from '@/lib/db'
import { interruptAndWaitForActiveCodexRun } from '@/lib/server/codex-app-server'
import { deleteCodexSessionWorkspace } from '@/lib/server/codex-session-workspace'
import { scheduleImageGcSweep } from '@/lib/server/image-gc'

export async function deleteCodexSession(ownerId: string, sessionId: string) {
    const existing = await prisma.codexSession.findFirst({
        where: { id: sessionId, ownerId },
        select: { id: true, ownerId: true },
    })
    if (!existing) return false

    await interruptAndWaitForActiveCodexRun(sessionId)
    await prisma.sceneEdit.updateMany({
        where: { sessionId, status: 'pending' },
        data: { status: 'accepted' },
    })
    const deleted = await prisma.codexSession.deleteMany({
        where: { id: sessionId, ownerId },
    })
    try {
        await deleteCodexSessionWorkspace(existing.ownerId, existing.id)
    } catch (error) {
        console.error('Delete Codex session workspace error:', error)
    }
    if (deleted.count > 0) scheduleImageGcSweep()
    return deleted.count > 0
}
