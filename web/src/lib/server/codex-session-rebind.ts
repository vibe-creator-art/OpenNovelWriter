import {
    DEFAULT_CODEX_MODEL,
    expandNativeCodexModels,
    parseCodexProviderModelsJson,
} from '@/lib/codex-config'
import { getPrismaClient } from '@/lib/db'
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
            // Fast mode is ChatGPT-only; always reset when rebinding.
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
