import fs from 'fs/promises'
import path from 'path'

import { getPrismaClient } from '@/lib/db'
import { ensureCodexConnectionHome } from '@/lib/server/codex-connection-storage'
import { getCodexInternalBaseUrl, getCodexInternalToken } from '@/lib/server/codex-internal-auth'
import { getOpenNovelWriterDataDir } from '@/lib/server/data-dir'

const prisma = getPrismaClient({ ensureModel: 'codexConnection' })
const MCP_SERVER_NAME = 'opennovelwriter'
const CONFIG_FILE_NAME = 'config.toml'
const MANAGED_BLOCK_START = '# BEGIN OpenNovelWriter MCP'
const MANAGED_BLOCK_END = '# END OpenNovelWriter MCP'

// How our first-party MCP tools are gated. `prompt` asks for approval each call (manual
// review). `approve` auto-approves, so no approval prompt is generated — required under the
// auto_review reviewer, where a prompt would be routed to a review subagent (an extra model
// call that can 503 and block the tool).
export type CodexToolsApprovalMode = 'prompt' | 'approve'

export async function syncActiveCodexConnectionMcp(ownerId: string, toolsApprovalMode?: CodexToolsApprovalMode) {
    const activeConnection = await prisma.codexConnection.findFirst({
        where: { ownerId, isActive: true },
        select: { id: true },
    })

    if (!activeConnection) return null

    return syncCodexConnectionMcp({
        ownerId,
        connectionId: activeConnection.id,
        toolsApprovalMode,
    })
}

export async function syncCodexConnectionMcp(input: {
    ownerId: string
    connectionId: string
    toolsApprovalMode?: CodexToolsApprovalMode
    reviewLevel?: string
}) {
    const codexHome = await ensureCodexConnectionHome(input.ownerId, input.connectionId)
    const configPath = path.join(codexHome, CONFIG_FILE_NAME)
    const existingConfig = await readFileOrDefault(configPath, '')
    const configToml = upsertOpenNovelWriterMcpConfig(existingConfig, {
        ownerId: input.ownerId,
        webRoot: await resolveWebRoot(),
        dataDir: getOpenNovelWriterDataDir(),
        databaseUrl: process.env.DATABASE_URL,
        internalBaseUrl: getCodexInternalBaseUrl(),
        internalToken: getCodexInternalToken(),
        toolsApprovalMode: input.toolsApprovalMode,
        reviewLevel: input.reviewLevel,
    })

    await fs.writeFile(configPath, configToml, 'utf8')

    return {
        codexHome,
        configPath,
        configToml,
    }
}

export function upsertOpenNovelWriterMcpConfig(input: string, options: {
    ownerId: string
    webRoot: string
    dataDir: string
    databaseUrl?: string
    internalBaseUrl?: string
    internalToken?: string
    toolsApprovalMode?: CodexToolsApprovalMode
    reviewLevel?: string
}) {
    const cleaned = removeOpenNovelWriterMcpSections(removeManagedBlock(normalizeText(input))).trimEnd()
    const block = buildOpenNovelWriterMcpBlock(options)
    return `${cleaned ? `${cleaned}\n\n` : ''}${block}\n`
}

function buildOpenNovelWriterMcpBlock(options: {
    ownerId: string
    webRoot: string
    dataDir: string
    databaseUrl?: string
    internalBaseUrl?: string
    internalToken?: string
    toolsApprovalMode?: CodexToolsApprovalMode
    reviewLevel?: string
}) {
    const scriptPath = path.join(options.webRoot, 'scripts', 'opennovelwriter-mcp-server.cjs')
    const envLines = [
        `OPENNOVELWRITER_OWNER_ID = "${escapeTomlString(options.ownerId)}"`,
        `OPENNOVELWRITER_DATA_DIR = "${escapeTomlString(options.dataDir)}"`,
    ]
    if (options.reviewLevel?.trim()) {
        // Lets the MCP server gate destructive tools (e.g. delete_snippet) on the session review
        // level: it raises an approval elicitation unless the author is at no_review.
        envLines.push(`OPENNOVELWRITER_REVIEW_LEVEL = "${escapeTomlString(options.reviewLevel.trim())}"`)
    }
    if (options.databaseUrl?.trim()) {
        envLines.push(`DATABASE_URL = "${escapeTomlString(options.databaseUrl.trim())}"`)
    }
    if (options.internalBaseUrl?.trim()) {
        envLines.push(`OPENNOVELWRITER_BASE_URL = "${escapeTomlString(options.internalBaseUrl.trim())}"`)
    }
    if (options.internalToken?.trim()) {
        envLines.push(`OPENNOVELWRITER_INTERNAL_TOKEN = "${escapeTomlString(options.internalToken.trim())}"`)
    }

    return [
        MANAGED_BLOCK_START,
        `[mcp_servers.${MCP_SERVER_NAME}]`,
        'command = "node"',
        `args = ["${escapeTomlString(scriptPath)}"]`,
        `cwd = "${escapeTomlString(options.webRoot)}"`,
        'startup_timeout_sec = 10',
        // Generous timeout: the run_llm tool blocks on an external model that can be slow.
        'tool_timeout_sec = 300',
        // First-party, owner-scoped tools. In auto/no review we pre-approve (`approve`) so no
        // approval prompt is generated — under the auto_review reviewer a prompt would be routed
        // to a review subagent (an extra model call that can 503 and block the tool). In manual
        // review we keep `prompt` so the human stays in the loop. Scene edits land as pending
        // author review regardless.
        `default_tools_approval_mode = "${options.toolsApprovalMode ?? 'prompt'}"`,
        'enabled = true',
        '',
        `[mcp_servers.${MCP_SERVER_NAME}.env]`,
        ...envLines,
        MANAGED_BLOCK_END,
    ].join('\n')
}

function removeManagedBlock(input: string) {
    const start = input.indexOf(MANAGED_BLOCK_START)
    if (start < 0) return input

    const end = input.indexOf(MANAGED_BLOCK_END, start)
    if (end < 0) return input.slice(0, start)

    return `${input.slice(0, start)}${input.slice(end + MANAGED_BLOCK_END.length)}`
}

function removeOpenNovelWriterMcpSections(input: string) {
    const lines = input.split('\n')
    const result: string[] = []
    let skipping = false

    for (const line of lines) {
        const tableName = parseTomlTableName(line)
        if (tableName) {
            skipping =
                tableName === `mcp_servers.${MCP_SERVER_NAME}` ||
                tableName.startsWith(`mcp_servers.${MCP_SERVER_NAME}.`)
        }

        if (!skipping) result.push(line)
    }

    return result.join('\n')
}

function parseTomlTableName(line: string) {
    const match = line.trim().match(/^\[([^\]]+)]$/)
    return match?.[1]?.trim() ?? null
}

async function resolveWebRoot() {
    const candidates = [
        process.cwd(),
        path.join(process.cwd(), 'web'),
    ]

    for (const candidate of candidates) {
        try {
            await fs.access(path.join(candidate, 'scripts', 'opennovelwriter-mcp-server.cjs'))
            return candidate
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
    }

    return candidates[0]
}

async function readFileOrDefault(filePath: string, fallback: string) {
    try {
        return await fs.readFile(filePath, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
        throw error
    }
}

function normalizeText(value: string) {
    return value.endsWith('\n') ? value : `${value}\n`
}

function escapeTomlString(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
