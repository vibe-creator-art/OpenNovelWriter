import fs from 'fs/promises'
import path from 'path'
import { getOpenNovelWriterDataDir } from '@/lib/server/data-dir'
import {
    getDefaultCodexAuthJson as getDefaultCodexAuthJsonValue,
    getDefaultCodexConfig as getDefaultCodexConfigValue,
    type CodexConnectionProviderType,
} from '@/lib/codex-config'

export type { CodexConnectionProviderType } from '@/lib/codex-config'

export function getCodexConnectionsRoot() {
    return path.join(getOpenNovelWriterDataDir(), 'codex', 'connections')
}

export function getCodexConnectionHome(ownerId: string, connectionId: string) {
    return path.join(getCodexConnectionsRoot(), ownerId, connectionId)
}

export async function ensureCodexConnectionHome(ownerId: string, connectionId: string) {
    const home = getCodexConnectionHome(ownerId, connectionId)
    await fs.mkdir(home, { recursive: true })
    return home
}

export async function readCodexConnectionFiles(ownerId: string, connectionId: string) {
    const home = await ensureCodexConnectionHome(ownerId, connectionId)
    const [authJson, configToml] = await Promise.all([
        readFileOrDefault(path.join(home, 'auth.json'), getDefaultCodexAuthJsonValue()),
        readFileOrDefault(path.join(home, 'config.toml'), getDefaultCodexConfigValue('openai-official')),
    ])

    return {
        home,
        authJson,
        configToml,
    }
}

export async function writeCodexConnectionFiles(input: {
    ownerId: string
    connectionId: string
    providerType: CodexConnectionProviderType
    authJson?: string
    configToml?: string
}) {
    const home = await ensureCodexConnectionHome(input.ownerId, input.connectionId)
    const authJson = normalizeAuthJson(input.authJson ?? getDefaultCodexAuthJsonValue(input.providerType))
    const configToml = normalizeText(input.configToml ?? getDefaultCodexConfigValue(input.providerType))

    await Promise.all([
        fs.writeFile(path.join(home, 'auth.json'), authJson, 'utf8'),
        fs.writeFile(path.join(home, 'config.toml'), configToml, 'utf8'),
    ])

    return {
        home,
        authJson,
        configToml,
    }
}

export async function deleteCodexConnectionHome(ownerId: string, connectionId: string) {
    await fs.rm(getCodexConnectionHome(ownerId, connectionId), {
        recursive: true,
        force: true,
    })
}

export function getDefaultCodexConfig(providerType: CodexConnectionProviderType) {
    return getDefaultCodexConfigValue(providerType)
}

export function getDefaultCodexAuthJson(providerType: CodexConnectionProviderType = 'openai-official') {
    return getDefaultCodexAuthJsonValue(providerType)
}

function normalizeText(value: string) {
    return value.endsWith('\n') ? value : `${value}\n`
}

function normalizeAuthJson(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return getDefaultCodexAuthJsonValue()

    const parsed = JSON.parse(trimmed)
    return `${JSON.stringify(parsed, null, 2)}\n`
}

async function readFileOrDefault(filePath: string, fallback: string) {
    try {
        return await fs.readFile(filePath, 'utf8')
    } catch {
        return fallback
    }
}
