export const OPENCODE_GO_SESSION_HEADER = 'x-opencode-session'
export const OPENCODE_GO_MODELS_URL = 'https://opencode.ai/inference/go/v1/models'
export const OPENCODE_GO_USER_AGENT = 'OpenNovelWriter/0.1.0'

const OPENCODE_GO_BASE_URLS = new Set([
    'https://opencode.ai/inference/go/openai/v1',
    'https://opencode.ai/inference/go/anthropic/v1',
    'https://opencode.ai/inference/go/google/v1beta',
])

export function isOpenCodeGoBaseUrl(baseUrl?: string | null) {
    return OPENCODE_GO_BASE_URLS.has(baseUrl?.trim().replace(/\/+$/, '') ?? '')
}

export function getOpenCodeGoHeaders(baseUrl?: string | null, sessionId?: string | null) {
    if (!isOpenCodeGoBaseUrl(baseUrl)) return undefined
    if (!sessionId?.trim()) throw new Error('OpenCode Go requires a conversation ID.')
    return {
        [OPENCODE_GO_SESSION_HEADER]: sessionId.trim(),
        'User-Agent': OPENCODE_GO_USER_AGENT,
    }
}

export function getOpenCodeGoFetch(baseUrl?: string | null, sessionId?: string | null): typeof fetch | undefined {
    const goHeaders = getOpenCodeGoHeaders(baseUrl, sessionId)
    if (!goHeaders) return undefined
    return (input, init) => {
        const headers = new Headers(init?.headers)
        for (const [name, value] of Object.entries(goHeaders)) headers.set(name, value)
        return fetch(input, { ...init, headers })
    }
}

export function getCodexOpenCodeGoConfig(connection: { providerType: string; baseUrl?: string | null }, sessionId: string): Record<string, unknown> {
    if (connection.providerType !== 'custom' || !isOpenCodeGoBaseUrl(connection.baseUrl)) return {}
    return {
        'model_providers.opennovelwriter.http_headers': { [OPENCODE_GO_SESSION_HEADER]: sessionId },
    }
}
