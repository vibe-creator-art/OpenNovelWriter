import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { getOpenNovelWriterDataDir } from '@/lib/server/data-dir'

const TOKEN_FILE_NAME = 'codex_internal_token'

function tokenFilePath() {
    return path.join(getOpenNovelWriterDataDir(), TOKEN_FILE_NAME)
}

/**
 * Shared secret that lets the local Codex MCP subprocess call back into the web
 * app's internal routes. The MCP server runs as a separate `node` process spawned
 * by Codex, so it cannot import server modules directly; instead it makes an HTTP
 * call authenticated with this token. The token is persisted next to the AI
 * credentials secret in the OpenNovelWriter data dir and injected into the MCP
 * environment by codex-mcp-sync.
 */
export function getCodexInternalToken(): string {
    const fromEnv = process.env.OPENNOVELWRITER_INTERNAL_TOKEN
    if (fromEnv && fromEnv.trim()) return fromEnv.trim()

    const file = tokenFilePath()
    try {
        const existing = fs.readFileSync(file, 'utf8').trim()
        if (existing) return existing
    } catch {
        // ignore and create below
    }

    const token = crypto.randomBytes(32).toString('base64url')
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`
        fs.writeFileSync(tmp, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
        fs.renameSync(tmp, file)
        return token
    } catch {
        throw new Error(
            'Failed to persist the Codex internal token. Set OPENNOVELWRITER_INTERNAL_TOKEN in the runtime environment.'
        )
    }
}

/**
 * Base URL the MCP subprocess uses to reach this web app. Resolved on the web
 * server (which knows its own PORT) at MCP-config sync time and injected into the
 * MCP environment. Overridable with OPENNOVELWRITER_BASE_URL.
 */
export function getCodexInternalBaseUrl(): string {
    const override = process.env.OPENNOVELWRITER_BASE_URL
    if (override && override.trim()) return override.trim().replace(/\/+$/, '')

    const port = process.env.PORT?.trim()
    return `http://127.0.0.1:${port && /^\d+$/.test(port) ? port : '3000'}`
}

/**
 * Constant-time comparison so the internal route can validate the token from an
 * incoming MCP request without leaking timing information.
 */
export function isValidCodexInternalToken(candidate: string | null | undefined): boolean {
    if (!candidate) return false
    let expected: string
    try {
        expected = getCodexInternalToken()
    } catch {
        return false
    }
    const a = Buffer.from(candidate)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
}
