import fs from 'fs/promises'
import path from 'path'

import { getPrismaClient } from '@/lib/db'
import { ensureCodexConnectionHome } from '@/lib/server/codex-connection-storage'
import { ensureManagedFileSymlink } from '@/lib/server/managed-symlink'

const prisma = getPrismaClient({ ensureModel: 'codexConnection' })
const AGENTS_FILE_NAME = 'AGENTS.md'

export async function syncActiveCodexConnectionCoreAgents(ownerId: string) {
    const activeConnection = await prisma.codexConnection.findFirst({
        where: { ownerId, isActive: true },
        select: { id: true },
    })

    if (!activeConnection) return null

    return syncCodexConnectionCoreAgents({
        ownerId,
        connectionId: activeConnection.id,
    })
}

export async function syncCodexConnectionCoreAgents(input: {
    ownerId: string
    connectionId: string
}) {
    const codexHome = await ensureCodexConnectionHome(input.ownerId, input.connectionId)
    const source = await resolveCoreAgentsPath()
    const destination = path.join(codexHome, AGENTS_FILE_NAME)

    await ensureManagedFileSymlink({
        source,
        destination,
        managedSourceRoot: path.dirname(source),
    })

    return {
        codexHome,
        agentsPath: destination,
    }
}

async function resolveCoreAgentsPath() {
    const relativePath = path.join('src', 'lib', 'server', 'codex-core', AGENTS_FILE_NAME)
    const candidates = [
        path.join(process.cwd(), relativePath),
        path.join(process.cwd(), 'web', relativePath),
    ]

    for (const candidate of candidates) {
        try {
            await fs.access(candidate)
            return candidate
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
    }

    return candidates[0]
}
