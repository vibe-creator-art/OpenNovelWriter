import fs from 'fs/promises'
import path from 'path'

import { getPrismaClient } from '@/lib/db'
import { ensureCodexConnectionHome } from '@/lib/server/codex-connection-storage'
import { getUserSkillsRoot, listSkills } from '@/lib/server/skill-storage'

const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

export async function syncActiveCodexConnectionSkills(ownerId: string) {
    const activeConnection = await prisma.codexConnection.findFirst({
        where: { ownerId, isActive: true },
        select: { id: true },
    })

    if (!activeConnection) return null

    return syncCodexConnectionSkills({
        ownerId,
        connectionId: activeConnection.id,
    })
}

export async function syncCodexConnectionSkills(input: {
    ownerId: string
    connectionId: string
}) {
    const [codexHome, skills] = await Promise.all([
        ensureCodexConnectionHome(input.ownerId, input.connectionId),
        listSkills(input.ownerId),
    ])
    const userSkillsRoot = getUserSkillsRoot(input.ownerId)
    const codexSkillsRoot = path.join(codexHome, 'skills')
    await fs.mkdir(codexSkillsRoot, { recursive: true })

    const enabledSkills = skills.filter((skill) => skill.enabled)
    const desiredLinks = new Map(
        enabledSkills.map((skill) => [
            skill.id,
            path.join(userSkillsRoot, skill.id),
        ])
    )

    const retainedLinks = await removeStaleManagedSkillLinks(codexSkillsRoot, userSkillsRoot, desiredLinks)

    for (const [skillId, sourceDirectory] of desiredLinks) {
        if (retainedLinks.has(skillId)) continue

        const destination = path.join(codexSkillsRoot, skillId)
        const relativeSource = path.relative(codexSkillsRoot, sourceDirectory)
        try {
            await fs.symlink(relativeSource, destination, 'dir')
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                throw new Error(`Cannot sync skill "${skillId}" because CODEX_HOME/skills already contains that name.`)
            }
            throw error
        }
    }

    return {
        codexHome,
        skillsRoot: codexSkillsRoot,
        linkedSkillIds: enabledSkills.map((skill) => skill.id),
    }
}

async function removeStaleManagedSkillLinks(
    codexSkillsRoot: string,
    userSkillsRoot: string,
    desiredLinks: Map<string, string>
) {
    const entries = await fs.readdir(codexSkillsRoot, { withFileTypes: true })
    const retainedLinks = new Set<string>()

    await Promise.all(
        entries.map(async (entry) => {
            if (!entry.isSymbolicLink()) return

            const destination = path.join(codexSkillsRoot, entry.name)
            const linkTarget = await fs.readlink(destination)
            const resolvedTarget = path.resolve(codexSkillsRoot, linkTarget)
            if (!isInsideDirectory(resolvedTarget, userSkillsRoot)) return

            const desiredTarget = desiredLinks.get(entry.name)
            if (desiredTarget && path.resolve(desiredTarget) === resolvedTarget) {
                retainedLinks.add(entry.name)
                return
            }

            await fs.unlink(destination)
        })
    )

    return retainedLinks
}

function isInsideDirectory(target: string, directory: string) {
    const relative = path.relative(path.resolve(directory), path.resolve(target))
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}
