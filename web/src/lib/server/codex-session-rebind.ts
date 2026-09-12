import {
    DEFAULT_CODEX_MODEL,
    expandNativeCodexModels,
    parseCodexProviderModelsJson,
} from '@/lib/codex-config'
import { getPrismaClient } from '@/lib/db'
import { finishActiveCodexRun, initializeCodexConnectionState, reserveActiveCodexRun } from '@/lib/server/codex-app-server'
import { deleteCodexConnectionHome, ensureCodexConnectionHome } from '@/lib/server/codex-connection-storage'
import { transferCodexConnectionThreads } from '@/lib/server/codex-connection-transfer'
import {
    DEFAULT_CODEX_REASONING_EFFORT,
    DEFAULT_CODEX_SERVICE_TIER,
    normalizeCodexReasoningEffort,
    normalizeCodexStringId,
} from '@/lib/server/codex-session'

const prisma = getPrismaClient({ ensureModel: 'codexSession' })

type RebindConnection = {
    id: string
    ownerId: string
    providerType: string
    defaultModelId: string | null
    modelsJson: string
}

export async function deleteCodexConnectionPreservingSessions(connection: RebindConnection) {
    const sessions = await prisma.codexSession.findMany({
        where: { ownerId: connection.ownerId, codexConnectionId: connection.id },
        select: { id: true, codexThreadId: true },
    })
    const target = sessions.length > 0 ? await prisma.codexConnection.findFirst({
        where: { ownerId: connection.ownerId, isActive: true, NOT: { id: connection.id } },
    }) : null
    if (sessions.length > 0 && !target) {
        throw new Error('Activate another Codex connection before deleting a connection used by conversations.')
    }

    const reservations = []
    try {
        for (const session of sessions) {
            const reservation = reserveActiveCodexRun(session.id)
            if (!reservation) throw new Error('Stop the running conversations before deleting their Codex connection.')
            reservations.push(reservation)
        }
        if (target) {
            const threadIds = sessions.flatMap((session) => session.codexThreadId ? [session.codexThreadId] : [])
            if (threadIds.length > 0) {
                const sourceHome = await ensureCodexConnectionHome(connection.ownerId, connection.id)
                const targetHome = await ensureCodexConnectionHome(target.ownerId, target.id)
                await Promise.all([initializeCodexConnectionState(sourceHome), initializeCodexConnectionState(targetHome)])
                await transferCodexConnectionThreads(sourceHome, targetHome, threadIds)
            }
            const modelId = resolveConnectionDefaultModelId(target)
            await prisma.$transaction(async (tx) => {
                await tx.codexSession.updateMany({
                    where: { ownerId: connection.ownerId, codexConnectionId: connection.id },
                    data: {
                        codexConnectionId: target.id,
                        modelId,
                        reasoningEffort: resolveConnectionDefaultReasoningEffort(target, modelId),
                        serviceTier: DEFAULT_CODEX_SERVICE_TIER,
                        updatedAt: new Date(),
                    },
                })
                await tx.codexConnection.delete({ where: { id: connection.id } })
            })
        } else {
            await prisma.codexConnection.delete({ where: { id: connection.id } })
        }
        await deleteCodexConnectionHome(connection.ownerId, connection.id)
    } finally {
        reservations.forEach(finishActiveCodexRun)
    }
}

/**
 * Empty "draft" sessions: created when the user types in the composer (or opens
 * a new thread) but never actually sends a turn. They pin the then-active
 * connection + model, so after switching Codex connections they look stuck on
 * the old provider. Rebind them to the newly activated connection.
 */
export async function rebindDraftCodexSessionsToConnection(connection: RebindConnection) {
    const modelId = resolveConnectionDefaultModelId(connection)
    const reasoningEffort = resolveConnectionDefaultReasoningEffort(connection, modelId)

    const result = await prisma.codexSession.updateMany({
        where: {
            ownerId: connection.ownerId,
            status: 'idle',
            codexThreadId: null,
            messagesJson: '[]',
        },
        data: {
            codexConnectionId: connection.id,
            modelId,
            reasoningEffort,
            // Service tiers are provider-specific, so reset when rebinding.
            serviceTier: DEFAULT_CODEX_SERVICE_TIER,
            updatedAt: new Date(),
        },
    })

    return { updatedCount: result.count }
}

function resolveConnectionDefaultModelId(connection: RebindConnection) {
    if (connection.providerType === 'custom') {
        const models = expandNativeCodexModels(parseCodexProviderModelsJson(connection.modelsJson))
        const preferred = normalizeCodexStringId(connection.defaultModelId)
        if (preferred && models.some((model) => model.id === preferred)) return preferred
        if (models[0]?.id) return models[0].id
    }
    return normalizeCodexStringId(connection.defaultModelId) ?? DEFAULT_CODEX_MODEL
}

function resolveConnectionDefaultReasoningEffort(connection: RebindConnection, modelId: string) {
    if (connection.providerType !== 'custom') return DEFAULT_CODEX_REASONING_EFFORT
    const models = expandNativeCodexModels(parseCodexProviderModelsJson(connection.modelsJson))
    const model = models.find((entry) => entry.id === modelId)
    return normalizeCodexReasoningEffort(model?.defaultReasoningEffort) ?? DEFAULT_CODEX_REASONING_EFFORT
}
