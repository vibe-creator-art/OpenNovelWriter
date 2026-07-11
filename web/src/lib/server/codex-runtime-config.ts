import fs from 'fs/promises'
import path from 'path'

import {
    expandNativeCodexModels,
    parseCodexProviderModelsJson,
    parseCodexUpstreamFormat,
    type CodexConnectionProviderType,
} from '@/lib/codex-config'
import { getCodexInternalBaseUrl, getCodexProxyToken } from '@/lib/server/codex-internal-auth'
import { CODEX_MODEL_CATALOG_FILE, writeCodexModelCatalog } from '@/lib/server/codex-model-catalog'
import { ensureCodexConnectionHome } from '@/lib/server/codex-connection-storage'

type RuntimeConnection = {
    id: string
    ownerId: string
    providerType: string
    upstreamFormat: string | null
    defaultModelId: string | null
    modelsJson: string
}

export async function syncCodexConnectionRuntimeFiles(connection: RuntimeConnection) {
    if ((connection.providerType as CodexConnectionProviderType) !== 'custom') {
        return ensureCodexConnectionHome(connection.ownerId, connection.id)
    }

    const upstreamFormat = parseCodexUpstreamFormat(connection.upstreamFormat)
    if (!upstreamFormat) throw new Error('Custom Codex connection is missing its upstream format.')
    const models = expandNativeCodexModels(parseCodexProviderModelsJson(connection.modelsJson))
    if (models.length === 0) throw new Error('Custom Codex connection has no models.')
    const defaultModelId = connection.defaultModelId?.trim() || ''
    const defaultModel = models.find((model) => model.id === defaultModelId)
    if (!defaultModel) throw new Error('Custom Codex connection has an invalid default model.')

    const codexHome = await ensureCodexConnectionHome(connection.ownerId, connection.id)
    await writeCodexModelCatalog({ codexHome, upstreamFormat, models })

    const proxyBaseUrl = `${getCodexInternalBaseUrl()}/api/internal/codex/upstream/${connection.id}`
    const authJson = `${JSON.stringify({ OPENAI_API_KEY: getCodexProxyToken(connection.id) }, null, 2)}\n`
    const configToml = [
        'model_provider = "opennovelwriter"',
        `model = ${tomlString(defaultModel.id)}`,
        `model_context_window = ${defaultModel.contextWindow}`,
        `model_auto_compact_token_limit = ${Math.floor(defaultModel.contextWindow * 0.95)}`,
        `model_reasoning_effort = ${tomlString(defaultModel.defaultReasoningEffort)}`,
        'disable_response_storage = true',
        `model_catalog_json = ${tomlString(CODEX_MODEL_CATALOG_FILE)}`,
        '',
        '[model_providers.opennovelwriter]',
        'name = "OpenNovelWriter Proxy"',
        `base_url = ${tomlString(proxyBaseUrl)}`,
        'wire_api = "responses"',
        'requires_openai_auth = true',
        '',
    ].join('\n')

    await Promise.all([
        writeAtomic(path.join(codexHome, 'auth.json'), authJson),
        writeAtomic(path.join(codexHome, 'config.toml'), configToml),
    ])
    return codexHome
}

async function writeAtomic(filePath: string, content: string) {
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporary, filePath)
}

function tomlString(value: string) {
    return JSON.stringify(value)
}
