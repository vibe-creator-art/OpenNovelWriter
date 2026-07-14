export const MIN_CODEX_SESSION_RETENTION_LIMIT = 10
export const DEFAULT_CODEX_SESSION_RETENTION_LIMIT = 10

export function parseCodexSessionRetentionLimit(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null
    return value >= MIN_CODEX_SESSION_RETENTION_LIMIT ? value : null
}
