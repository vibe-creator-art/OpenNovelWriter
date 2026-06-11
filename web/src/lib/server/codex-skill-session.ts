import fs from 'fs/promises'
import path from 'path'

import { readSkill } from '@/lib/server/skill-storage'
import { materializeSkillPrompt, type MaterializedSkillPrompt } from '@/lib/server/skill-prompt-materialize'
import {
    ensureCodexSessionWorkspace,
    getCodexSessionWorkspacePath,
} from '@/lib/server/codex-session-workspace'

export type SeededSkillArtifact = {
    fileName: string
    absolutePath: string
    groupId: string | null
    groupName: string | null
    missingInputNames: string[]
}

/**
 * When a `scene_operation` Codex session is created for a skill that has an associated prompt,
 * pre-assemble that prompt into a conversation markdown draft and write it into the session's
 * `artifacts/` directory. Codex then fills any `<<<NEEDS INPUT>>>` placeholders, trims, and calls
 * `run_llm` against it. Returns `null` when the skill has no associated prompt or it could not be
 * materialized (a no-op that leaves the session as a plain skill run).
 */
export async function seedSkillSessionArtifact(input: {
    ownerId: string
    novelId: string
    sessionId: string
    skillId: string
    /** Concrete scene for scene-bound skills; omitted for general chat skills. */
    sceneId?: string
    /** Scene-continuation panels and the chat tweak dialog pass already-resolved prompt blocks. */
    renderedBlocks?: Array<{ role: string; text: string }>
    panelId?: string
}): Promise<SeededSkillArtifact | null> {
    const skill = await readSkill(input.ownerId, input.skillId).catch(() => null)
    if (!skill) return null

    const promptName = skill.prompt?.trim()
    if (!promptName) return null

    const materialized: MaterializedSkillPrompt | null = await materializeSkillPrompt({
        ownerId: input.ownerId,
        skillName: skill.name,
        promptName,
        sceneId: input.sceneId,
        renderedBlocks: input.renderedBlocks,
        panelRef: input.panelId,
    })
    if (!materialized) return null

    const sessionPath = await ensureCodexSessionWorkspace({
        ownerId: input.ownerId,
        novelId: input.novelId,
        sessionId: input.sessionId,
    })

    const artifactsDir = path.join(sessionPath, 'artifacts')
    await fs.mkdir(artifactsDir, { recursive: true })
    const absolutePath = path.join(artifactsDir, materialized.fileName)
    await fs.writeFile(absolutePath, materialized.markdown, 'utf8')

    return {
        fileName: materialized.fileName,
        absolutePath,
        groupId: materialized.groupId,
        groupName: materialized.groupName,
        missingInputNames: materialized.missingInputNames,
    }
}

export { getCodexSessionWorkspacePath }
