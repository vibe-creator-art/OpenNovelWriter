import { createRequire } from 'module'
import { getPrismaClient } from '@/lib/db'
import { syncNovelWorkspaceChapter, syncNovelWorkspaceOutline } from '@/lib/server/novel-workspace'
import { updateSceneContentWithStats } from '@/lib/server/manuscript-word-count'

const require = createRequire(import.meta.url)
const { revertHunk } = require('./manuscript-edit.cjs') as {
    revertHunk: (
        currentHtml: string,
        beforeHtml: string,
        afterHtml: string,
        afterAnchorHtml: string
    ) => { ok: true; newHtml: string } | { ok: false; error: string }
}

const prisma = getPrismaClient({ ensureModel: 'novelWritingDay' })

export type SceneEditRecord = {
    id: string
    novelId: string
    sceneId: string
    chapterId: string
}

export type SceneEditActionResult = { ok: true } | { ok: false; error: string; status?: number }

async function loadOwnedPendingEdit(ownerId: string, editId: string) {
    return prisma.sceneEdit.findFirst({
        where: { id: editId, novel: { ownerId } },
        select: {
            id: true,
            novelId: true,
            sceneId: true,
            chapterId: true,
            status: true,
            beforeHtml: true,
            afterHtml: true,
            afterAnchorHtml: true,
        },
    })
}

export async function acceptSceneEdit(ownerId: string, editOrId: SceneEditRecord | string): Promise<SceneEditActionResult> {
    const editId = typeof editOrId === 'string' ? editOrId : editOrId.id
    const edit = await loadOwnedPendingEdit(ownerId, editId)
    if (!edit) return { ok: false, error: 'Scene edit not found', status: 404 }
    if (edit.status !== 'pending') return { ok: true } // already resolved

    // The change is already in the scene content; accepting only clears the pending mark.
    await prisma.sceneEdit.update({ where: { id: edit.id }, data: { status: 'accepted' } })
    return { ok: true }
}

export async function rejectSceneEdit(ownerId: string, editOrId: SceneEditRecord | string): Promise<SceneEditActionResult> {
    const editId = typeof editOrId === 'string' ? editOrId : editOrId.id
    const edit = await loadOwnedPendingEdit(ownerId, editId)
    if (!edit) return { ok: false, error: 'Scene edit not found', status: 404 }
    if (edit.status !== 'pending') return { ok: true }

    const scene = await prisma.scene.findFirst({
        where: { id: edit.sceneId },
        select: { id: true, content: true },
    })

    // Scene was deleted in the meantime: nothing to revert, just drop the pending mark.
    if (!scene) {
        await prisma.sceneEdit.update({ where: { id: edit.id }, data: { status: 'rejected' } })
        return { ok: true }
    }

    const result = revertHunk(scene.content || '', edit.beforeHtml, edit.afterHtml, edit.afterAnchorHtml)
    if (!result.ok) {
        return { ok: false, error: result.error, status: 409 }
    }

    await updateSceneContentWithStats(prisma, scene.id, result.newHtml)
    await prisma.sceneEdit.update({ where: { id: edit.id }, data: { status: 'rejected' } })
    await Promise.all([
        syncNovelWorkspaceOutline(ownerId, edit.novelId),
        syncNovelWorkspaceChapter(ownerId, edit.novelId, edit.chapterId),
    ])
    return { ok: true }
}
