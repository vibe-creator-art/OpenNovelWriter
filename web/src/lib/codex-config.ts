export type CodexConnectionProviderType = 'openai-official' | 'custom'

export type CodexCustomProviderSettings = {
    apiKey: string
    baseUrl: string
    model: string
}

export const DEFAULT_CODEX_CUSTOM_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol'

const DEFAULT_SHARED_CONFIG_LINES = [
    'model_context_window = 300000',
    'model_auto_compact_token_limit = 285000',
    'model_reasoning_effort = "high"',
    'disable_response_storage = true',
]

export function getDefaultCodexCustomSettings(): CodexCustomProviderSettings {
    return {
        apiKey: '',
        baseUrl: DEFAULT_CODEX_CUSTOM_BASE_URL,
        model: DEFAULT_CODEX_MODEL,
    }
}

export function getDefaultCodexAuthJson(
    providerType: CodexConnectionProviderType = 'openai-official'
) {
    if (providerType === 'custom') {
        return buildCustomCodexAuthJson(getDefaultCodexCustomSettings())
    }
    return '{}\n'
}

export function getDefaultCodexConfig(providerType: CodexConnectionProviderType) {
    if (providerType === 'custom') {
        return buildCustomCodexConfigToml(getDefaultCodexCustomSettings())
    }
    return [...DEFAULT_SHARED_CONFIG_LINES, ''].join('\n')
}

export function buildCustomCodexAuthJson(settings: CodexCustomProviderSettings) {
    return `${JSON.stringify(
        {
            OPENAI_API_KEY: settings.apiKey,
        },
        null,
        2
    )}\n`
}

export function buildCustomCodexConfigToml(settings: CodexCustomProviderSettings) {
    return [
        'model_provider = "custom"',
        `model = "${escapeTomlString(settings.model)}"`,
        ...DEFAULT_SHARED_CONFIG_LINES,
        '',
        '[model_providers]',
        '[model_providers.custom]',
        'name = "custom"',
        `base_url = "${escapeTomlString(normalizeBaseUrl(settings.baseUrl))}"`,
        'wire_api = "responses"',
        'requires_openai_auth = true',
        '',
    ].join('\n')
}

export function parseCodexCustomSettingsFromFiles(input: {
    authJson: string
    configToml: string
    fallback?: CodexCustomProviderSettings
}) {
    const fallback = input.fallback ?? getDefaultCodexCustomSettings()
    const parsedAuthJson = parseJsonObject(input.authJson)
    const customSection = extractTomlSection(input.configToml, 'model_providers.custom')

    return {
        apiKey:
            typeof parsedAuthJson?.OPENAI_API_KEY === 'string'
                ? parsedAuthJson.OPENAI_API_KEY
                : fallback.apiKey,
        baseUrl:
            extractTomlQuotedValue(customSection ?? input.configToml, 'base_url') ?? fallback.baseUrl,
        model: extractTomlQuotedValue(input.configToml, 'model') ?? fallback.model,
    }
}

export function parseCodexModelFromConfig(configToml: string, fallback = DEFAULT_CODEX_MODEL) {
    return extractTomlQuotedValue(configToml, 'model') ?? fallback
}

function parseJsonObject(value: string) {
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
        return null
    }
}

function extractTomlSection(content: string, sectionName: string) {
    const escapedSectionName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = content.match(
        new RegExp(`(?:^|\\n)\\[${escapedSectionName}\\]\\n([\\s\\S]*?)(?=\\n\\[[^\\n]+\\]|$)`)
    )
    return match?.[1] ?? null
}

function extractTomlQuotedValue(content: string, key: string) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = content.match(new RegExp(`^${escapedKey}\\s*=\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'm'))
    return match?.[1] ? unescapeTomlString(match[1]) : null
}

function normalizeBaseUrl(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return DEFAULT_CODEX_CUSTOM_BASE_URL
    return trimmed.replace(/\/+$/, '')
}

function escapeTomlString(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function unescapeTomlString(value: string) {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}
