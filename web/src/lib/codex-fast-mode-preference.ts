import type { CodexConnectionSummary, CodexModelCatalogEntry, CodexServiceTier } from '@/lib/api'
import { isCodexFastModeAllowed } from '@/lib/codex-config'

const CODEX_FAST_MODE_STORAGE_KEY = 'codex.fastMode'

export function getStickyCodexFastMode() {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(CODEX_FAST_MODE_STORAGE_KEY) === 'true'
}

export function setStickyCodexFastMode(enabled: boolean) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CODEX_FAST_MODE_STORAGE_KEY, String(enabled))
}

export function modelSupportsCodexFastMode(models: CodexModelCatalogEntry[], modelId: string) {
    const normalizedModelId = modelId.trim().toLowerCase()
    return models.some(
        (model) => model.id.trim().toLowerCase() === normalizedModelId
            && model.serviceTiers.some((tier) => tier.name.trim().toLowerCase() === 'fast')
    )
}

export function resolvePreferredCodexServiceTier(input: {
    enabled: boolean
    connection: Pick<CodexConnectionSummary, 'providerType' | 'authStatus' | 'authType'> | null
    customFastModeEnabled: boolean
    models: CodexModelCatalogEntry[]
    modelId: string
}): CodexServiceTier {
    return input.enabled
        && isCodexFastModeAllowed(input.connection, input.customFastModeEnabled)
        && modelSupportsCodexFastMode(input.models, input.modelId)
        ? 'fast'
        : 'standard'
}
