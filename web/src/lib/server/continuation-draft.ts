import { prisma } from '@/lib/db'
import { deleteCodexSession } from '@/lib/server/codex-session-deletion'

export type ContinuationDraftDto = {
    panelId: string
    novelId: string
    sceneId: string
    chapterId: string
    codexSessionId: string | null
    skillId: string | null
    content: string
    planning: string
    updatedBy: string
    updatedAt: string
}

type ContinuationDraftRecord = {
    panelId: string
    novelId: string
    sceneId: string
    chapterId: string
    codexSessionId: string | null
    skillId: string | null
    content: string
    planning: string
    updatedBy: string
    updatedAt: Date
}

export function serializeContinuationDraft(record: ContinuationDraftRecord): ContinuationDraftDto {
    return {
        panelId: record.panelId,
        novelId: record.novelId,
        sceneId: record.sceneId,
        chapterId: record.chapterId,
        codexSessionId: record.codexSessionId,
        skillId: record.skillId,
        content: record.content,
        planning: record.planning,
        updatedBy: record.updatedBy,
        updatedAt: record.updatedAt.toISOString(),
    }
}

/** Load a draft and verify its novel belongs to the owner. Returns null when missing or not owned. */
export async function getOwnedContinuationDraft(ownerId: string, panelId: string) {
    const draft = await prisma.sceneContinuationDraft.findUnique({ where: { panelId } })
    if (!draft) return null
    const novel = await prisma.novel.findFirst({ where: { id: draft.novelId, ownerId }, select: { id: true } })
    if (!novel) return null
    return draft
}

/** Delete a draft row only. Leaf operation; does not touch any linked session. */
export async function rawDeleteContinuationDraft(panelId: string) {
    await prisma.sceneContinuationDraft.deleteMany({ where: { panelId } })
}

/**
 * Deleting a scene or chapter removes the inline continuation panels living in it, so their
 * shared drafts and the paired Codex sessions must go too (the panel markers vanish with the
 * scene/chapter content). Call BEFORE deleting the scene(s). No marker strip is needed — the
 * surrounding HTML is being deleted anyway.
 */
export async function cascadeDeleteContinuationDraftsForScenes(ownerId: string, sceneIds: string[]) {
    if (sceneIds.length === 0) return []
    const drafts = await prisma.sceneContinuationDraft.findMany({
        where: { sceneId: { in: sceneIds } },
        select: { panelId: true, codexSessionId: true },
    })
    if (drafts.length === 0) return []
    const deletedSessionIds: string[] = []
    for (const draft of drafts) {
        if (!draft.codexSessionId) continue
        if (await deleteCodexSession(ownerId, draft.codexSessionId)) {
            deletedSessionIds.push(draft.codexSessionId)
        }
    }
    await prisma.sceneContinuationDraft.deleteMany({ where: { sceneId: { in: sceneIds } } })
    return deletedSessionIds
}

/**
 * Remove the `<onw-scene-continuation data-panel-id="X">` marker from a scene's stored HTML.
 * Used when a session is deleted server-side so its panel disappears from the manuscript even
 * when the editor is not currently open (the open-editor case is handled client-side via event).
 * Returns true when the scene HTML changed.
 */
export async function stripContinuationPanelMarker(sceneId: string, panelId: string) {
    const scene = await prisma.scene.findUnique({ where: { id: sceneId }, select: { id: true, content: true } })
    if (!scene) return false
    const next = removePanelMarkerFromHtml(scene.content || '', panelId)
    if (next === scene.content) return false
    await prisma.scene.update({ where: { id: sceneId }, data: { content: next } })
    return true
}

function removePanelMarkerFromHtml(html: string, panelId: string) {
    if (!html || !panelId) return html
    const escaped = panelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match the atom node element with the matching data-panel-id, paired or self-closing.
    const pattern = new RegExp(
        `<onw-scene-continuation\\b[^>]*\\bdata-panel-id=["']${escaped}["'][^>]*>(?:</onw-scene-continuation>)?`,
        'gi'
    )
    return html.replace(pattern, '')
}
