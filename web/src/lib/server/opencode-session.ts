import { createHash } from 'crypto'

/**
 * Stable per-session header for gateways that key billing/caching on a session
 * identifier (e.g. an "opencode-go" subscription gateway requires
 * `x-opencode-session`). Same session -> same identifier is a hard requirement;
 * different sessions -> different identifiers is derived naturally from the
 * stable session id (CodexSession.id / EditorChatConversation.id / Scene.id).
 */
export const OPENCODE_SESSION_HEADER = 'x-opencode-session'

/**
 * Path segment used to carry the session marker from the Codex app-server runtime
 * config (config.toml `base_url`) to the upstream proxy route:
 * `.../upstream/<connectionId>/os/<key>/v1/responses`.
 * The proxy strips it before forwarding. Path (not query) is used because the
 * Codex app-server appends its endpoint path AFTER `base_url`, which would mangle
 * a query-string marker.
 */
export const OPENCODE_SESSION_PATH_SEGMENT = 'os'

/** Deterministic 8-char (hex) identifier for a session. Stable for the same session id. */
export function deriveOpencodeSessionKey(sessionId: string): string {
    return createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 8)
}