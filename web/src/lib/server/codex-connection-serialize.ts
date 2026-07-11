import { parseCodexProviderModelsJson, parseCodexUpstreamFormat } from '@/lib/codex-config'

export type SerializableCodexConnection = {
    id: string
    name: string
    providerType: string
    upstreamFormat: string | null
    baseUrl: string | null
    encryptedApiKey: string | null
    defaultModelId: string | null
    modelsJson: string
    isActive: boolean
    note: string | null
    authStatus: string
    authType: string | null
    accountEmail: string | null
    accountPlan: string | null
    lastAuthError: string | null
    createdAt: Date
    updatedAt: Date
}

export function serializeCodexConnection(connection: SerializableCodexConnection) {
    return {
        id: connection.id,
        name: connection.name,
        providerType: connection.providerType,
        upstreamFormat: parseCodexUpstreamFormat(connection.upstreamFormat),
        baseUrl: connection.baseUrl,
        hasApiKey: Boolean(connection.encryptedApiKey),
        defaultModelId: connection.defaultModelId,
        models: parseCodexProviderModelsJson(connection.modelsJson),
        isActive: connection.isActive,
        note: connection.note,
        authStatus: connection.authStatus,
        authType: connection.authType,
        accountEmail: connection.accountEmail,
        accountPlan: connection.accountPlan,
        lastAuthError: connection.lastAuthError,
        createdAt: connection.createdAt.toISOString(),
        updatedAt: connection.updatedAt.toISOString(),
    }
}
