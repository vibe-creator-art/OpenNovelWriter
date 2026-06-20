import fs from 'fs/promises'
import path from 'path'

import { getOpenNovelWriterDataDir } from '@/lib/server/data-dir'

type AgentMeta = {
    name: string
    enabled: boolean
}

export type AgentRecord = {
    id: string
    name: string
    enabled: boolean
    content: string
    createdAt: Date
    updatedAt: Date
}

const AGENT_FILE_NAME = 'AGENTS.md'
const AGENT_META_FILE_NAME = 'meta.json'

export class AgentNotFoundError extends Error {}
export class DuplicateAgentNameError extends Error {}

export function getAgentsRoot() {
    return path.join(getOpenNovelWriterDataDir(), 'agents')
}

export function getUserAgentsRoot(ownerId: string) {
    return path.join(getAgentsRoot(), ownerId)
}

export async function listAgents(ownerId: string) {
    const root = getUserAgentsRoot(ownerId)
    await fs.mkdir(root, { recursive: true })

    const entries = await fs.readdir(root, { withFileTypes: true })
    const agents = await Promise.all(
        entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
                try {
                    return await readAgent(ownerId, entry.name)
                } catch {
                    return null
                }
            })
    )

    return agents
        .filter((agent): agent is AgentRecord => agent !== null)
        .sort(
            (left, right) =>
                Number(right.enabled) - Number(left.enabled)
                || right.updatedAt.getTime() - left.updatedAt.getTime()
                || left.name.localeCompare(right.name)
        )
}

export async function readAgent(ownerId: string, agentId: string) {
    const directoryName = normalizeAgentId(agentId)
    const directory = getAgentDirectory(ownerId, directoryName)
    const agentFilePath = path.join(directory, AGENT_FILE_NAME)
    const metaFilePath = path.join(directory, AGENT_META_FILE_NAME)

    const [content, metaRaw, agentStats, metaStats] = await Promise.all([
        fs.readFile(agentFilePath, 'utf8'),
        fs.readFile(metaFilePath, 'utf8'),
        fs.stat(agentFilePath),
        fs.stat(metaFilePath),
    ])

    const meta = parseAgentMeta(metaRaw)

    return {
        id: directoryName,
        name: meta.name,
        enabled: meta.enabled,
        content: normalizeAgentContent(content),
        createdAt: new Date(Math.min(agentStats.birthtimeMs, metaStats.birthtimeMs)),
        updatedAt: new Date(Math.max(agentStats.mtimeMs, metaStats.mtimeMs)),
    } satisfies AgentRecord
}

export async function createAgent(input: {
    ownerId: string
    name: string
}) {
    const root = getUserAgentsRoot(input.ownerId)
    await fs.mkdir(root, { recursive: true })

    const existingKeys = await loadAgentNameKeys(input.ownerId)
    const uniqueName = getNextAvailableNumberedAgentName(input.name, existingKeys)
    const directoryName = await getUniqueAgentDirectoryName(root, uniqueName)
    const directory = path.join(root, directoryName)

    await fs.mkdir(directory, { recursive: true })
    await Promise.all([
        fs.writeFile(path.join(directory, AGENT_FILE_NAME), createDefaultAgentMarkdown(uniqueName), 'utf8'),
        writeAgentMeta(directory, {
            name: uniqueName,
            enabled: false,
        }),
    ])

    return readAgent(input.ownerId, directoryName)
}

export async function updateAgent(input: {
    ownerId: string
    agentId: string
    name?: string
    content?: string
    enabled?: boolean
}) {
    const directoryName = normalizeAgentId(input.agentId)
    const directory = getAgentDirectory(input.ownerId, directoryName)
    await ensureAgentExists(directory)

    const current = await readAgent(input.ownerId, directoryName)
    const nextName = typeof input.name === 'string' ? input.name.trim() : current.name
    const nextContent = typeof input.content === 'string' ? normalizeAgentContent(input.content) : current.content
    const nextEnabled = typeof input.enabled === 'boolean' ? input.enabled : current.enabled

    if (!nextName) {
        throw new Error('Agent name cannot be empty')
    }

    const existingKeys = await loadAgentNameKeys(input.ownerId, directoryName)
    const nextKey = toAgentNameKey(nextName)
    if (nextKey && existingKeys.has(nextKey)) {
        throw new DuplicateAgentNameError('Agent name already exists')
    }

    // The directory name is a stable id: renaming an agent only rewrites meta.json/AGENTS.md, it never
    // moves the directory. This removes the autosave race where a debounced save targeted a renamed dir.
    await Promise.all([
        fs.writeFile(path.join(directory, AGENT_FILE_NAME), nextContent, 'utf8'),
        writeAgentMeta(directory, {
            name: nextName,
            enabled: nextEnabled,
        }),
    ])

    if (nextEnabled) {
        await disableOtherAgents(input.ownerId, directoryName)
    }

    return readAgent(input.ownerId, directoryName)
}

export async function deleteAgent(ownerId: string, agentId: string) {
    const directoryName = normalizeAgentId(agentId)
    await fs.rm(getAgentDirectory(ownerId, directoryName), {
        recursive: true,
        force: true,
    })
}

export function toAgentDto(record: AgentRecord) {
    return {
        id: record.id,
        name: record.name,
        enabled: record.enabled,
        content: record.content,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    }
}

export function getAgentValidationErrorDetail(error: unknown) {
    if (error instanceof AgentNotFoundError) return 'Agent not found'
    if (error instanceof DuplicateAgentNameError) return error.message
    const message = error instanceof Error ? error.message.trim() : String(error).trim()
    return message || 'Internal server error'
}

function getAgentDirectory(ownerId: string, agentId: string) {
    return path.join(getUserAgentsRoot(ownerId), agentId)
}

function normalizeAgentId(agentId: string) {
    const trimmed = agentId.trim()
    if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
        throw new Error('Invalid agent id')
    }
    return trimmed
}

function normalizeAgentContent(content: string) {
    const normalized = content.replace(/\r\n/g, '\n')
    if (!normalized.trim()) return '\n'
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

async function writeAgentMeta(directory: string, meta: AgentMeta) {
    await fs.writeFile(
        path.join(directory, AGENT_META_FILE_NAME),
        `${JSON.stringify(meta, null, 2)}\n`,
        'utf8'
    )
}

async function getUniqueAgentDirectoryName(root: string, name: string) {
    const base = sanitizeAgentDirectoryName(name) || 'agent'
    let candidate = base
    let counter = 1

    for (;;) {
        try {
            await fs.access(path.join(root, candidate))
            counter += 1
            candidate = `${base}-${counter}`
        } catch {
            return candidate
        }
    }
}

function sanitizeAgentDirectoryName(name: string) {
    return name
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
}

function createDefaultAgentMarkdown(name: string) {
    return [
        `# ${name}`,
        '',
        '这是本工作区的 Agent 设定，会作为补充指令附加到 Codex 会话中。请按需修改，删掉用不到的部分。',
        '',
        '## 角色',
        '你是这个小说项目的写作助手。先理解用户意图，再决定如何行动，不要擅自扩大任务范围。',
        '',
        '## 理解需求',
        '- 动手前先弄清楚用户到底想要什么：构思、续写、润色、审阅，还是分析设定与情节。',
        '- 需求不清晰时，先简要确认，再开始工作。',
        '- 紧扣当前小说的设定、人物和已有情节，保持前后一致。',
        '',
        '## 工作方式',
        '- 合理使用可用的工具和小说上下文：需要了解剧情时，先读 `novel/` 中的大纲和章节再作答。',
        '- 修改标题、场景总结或保存片段等操作，使用对应的 OpenNovelWriter 工具，不要直接改投影文件。',
        '- 输出清晰、克制、可执行，优先在对话里把分析讲清楚。',
        '',
        '## 写作偏好',
        '- 在这里描述期望的语言风格、叙事视角和节奏。',
        '- 列出需要避免的内容，或固定要遵守的设定约束。',
        '',
        '## 规则',
        '1. 在此填写始终需要遵守的具体要求。',
        '2. 设定就绪后，删除上面的占位说明。',
        '',
    ].join('\n')
}

function parseAgentMeta(content: string): AgentMeta {
    let parsed: unknown
    try {
        parsed = JSON.parse(content)
    } catch {
        throw new Error('Invalid agent metadata')
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid agent metadata')
    }

    const record = parsed as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) {
        throw new Error('Agent metadata must include a non-empty name')
    }

    return {
        name,
        enabled: record.enabled === true,
    }
}

async function loadAgentNameKeys(ownerId: string, excludeId?: string) {
    const agents = await listAgents(ownerId)
    const keys = new Set<string>()
    for (const agent of agents) {
        if (excludeId && agent.id === excludeId) continue
        const key = toAgentNameKey(agent.name)
        if (key) keys.add(key)
    }
    return keys
}

function getNextAvailableNumberedAgentName(baseName: string, existingKeys: Set<string>) {
    const trimmed = baseName.trim()
    const base = trimmed || 'New agent'
    if (!existingKeys.has(toAgentNameKey(base))) return base

    for (let i = 1; i < 10_000; i += 1) {
        const candidate = `${base} ${i}`
        if (!existingKeys.has(toAgentNameKey(candidate))) return candidate
    }

    return `${base} ${Date.now()}`
}

function toAgentNameKey(name: string) {
    return name.trim().toLowerCase()
}

async function ensureAgentExists(directory: string) {
    try {
        await Promise.all([
            fs.access(path.join(directory, AGENT_FILE_NAME)),
            fs.access(path.join(directory, AGENT_META_FILE_NAME)),
        ])
    } catch {
        throw new AgentNotFoundError('Agent not found')
    }
}

async function disableOtherAgents(ownerId: string, enabledAgentId: string) {
    const root = getUserAgentsRoot(ownerId)
    const entries = await fs.readdir(root, { withFileTypes: true })

    await Promise.all(
        entries
            .filter((entry) => entry.isDirectory() && entry.name !== enabledAgentId)
            .map(async (entry) => {
                const directory = getAgentDirectory(ownerId, entry.name)
                const metaPath = path.join(directory, AGENT_META_FILE_NAME)

                try {
                    const meta = parseAgentMeta(await fs.readFile(metaPath, 'utf8'))
                    if (!meta.enabled) return
                    await writeAgentMeta(directory, { ...meta, enabled: false })
                } catch {
                    // Ignore invalid agent directories while switching the active agent.
                }
            })
    )
}
