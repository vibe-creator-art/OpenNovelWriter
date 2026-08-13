import fs from 'fs/promises'
import path from 'path'

import {
    AGENT_PRESET_SCHEMA,
    AGENT_PRESET_VERSION,
    serializeAgentPresetJson,
    type AgentPresetAssetV1,
} from '@/lib/agent-preset'
import type { BuiltinAgentPresetRegistryEntry } from '@/agent-presets'
import {
    createAgentFromContent,
    listAgents,
    readAgent,
    replaceAgentContent,
    setAgentPresetOrigin,
    toAgentDto,
} from '@/lib/server/agent-storage'

function normalizeNameKey(value: string) {
    return value.trim().toLowerCase()
}

export type BuiltOwnedAgentPreset = {
    preset: AgentPresetAssetV1
    content: string
}

export async function buildAgentPresetAssetFromOwnedAgent(params: {
    ownerId: string
    agentId: string
    presetId: string
    name: string
    description: string | null
    revision: number
}): Promise<{ ok: true; built: BuiltOwnedAgentPreset } | { ok: false; status: number; detail: string }> {
    const agent = await readAgent(params.ownerId, params.agentId).catch(() => null)
    if (!agent) return { ok: false, status: 404, detail: 'Agent not found.' }

    const exportedAt = new Date().toISOString()
    return {
        ok: true,
        built: {
            preset: {
                schema: AGENT_PRESET_SCHEMA,
                version: AGENT_PRESET_VERSION,
                metadata: {
                    presetId: params.presetId,
                    name: params.name,
                    description: params.description,
                    revision: params.revision,
                    exportedAt,
                },
                agent: 'agent',
            },
            content: agent.content,
        },
    }
}

/** Write the manifest and AGENTS.md as one replaceable preset directory. */
export async function writeAgentPresetDirectory(params: {
    assetDirectoryPath: string
    built: BuiltOwnedAgentPreset
    replaceExisting: boolean
}) {
    const parent = path.dirname(params.assetDirectoryPath)
    await fs.mkdir(parent, { recursive: true })
    const baseName = path.basename(params.assetDirectoryPath)
    const staging = path.join(parent, `.${baseName}.staging-${crypto.randomUUID()}`)
    const backup = path.join(parent, `.${baseName}.backup-${crypto.randomUUID()}`)
    await fs.mkdir(staging)
    try {
        await fs.mkdir(path.join(staging, 'agent'))
        await fs.writeFile(path.join(staging, 'agent', 'AGENTS.md'), params.built.content, 'utf8')
        await fs.writeFile(
            path.join(staging, 'preset.json'),
            `${serializeAgentPresetJson(params.built.preset)}\n`,
            'utf8'
        )

        if (!params.replaceExisting) {
            await fs.rename(staging, params.assetDirectoryPath)
            return
        }

        try {
            await fs.rename(params.assetDirectoryPath, backup)
        } catch (error) {
            await fs.rm(staging, { recursive: true, force: true })
            throw error
        }
        try {
            await fs.rename(staging, params.assetDirectoryPath)
        } catch (error) {
            await fs.rename(backup, params.assetDirectoryPath).catch(() => undefined)
            throw error
        }
        await fs.rm(backup, { recursive: true, force: true })
    } catch (error) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
        throw error
    }
}

export async function importAgentPresetForOwner(params: {
    ownerId: string
    entry: BuiltinAgentPresetRegistryEntry
    overwriteExisting: boolean
}): Promise<
    | { ok: true; agents: ReturnType<typeof toAgentDto>[] }
    | { ok: false; status: number; detail: string; code?: string; names?: string[] }
> {
    const existing = await listAgents(params.ownerId)
    const existingByNameKey = new Map(existing.map((agent) => [normalizeNameKey(agent.name), agent]))
    const incomingName = params.entry.preset.metadata.name
    const incomingKey = normalizeNameKey(incomingName)
    const conflicting = existingByNameKey.get(incomingKey) ?? null

    if (conflicting && !params.overwriteExisting) {
        return {
            ok: false,
            status: 409,
            detail: `Agent name already exists: ${incomingName}`,
            code: 'AGENT_NAME_ALREADY_EXISTS',
            names: [incomingName],
        }
    }

    const origin = {
        presetId: params.entry.preset.metadata.presetId,
        revision: params.entry.preset.metadata.revision,
    }

    let written
    if (conflicting && params.overwriteExisting) {
        written = await replaceAgentContent({
            ownerId: params.ownerId,
            agentId: conflicting.id,
            name: incomingName,
            content: params.entry.source.content,
        })
    } else {
        written = await createAgentFromContent({
            ownerId: params.ownerId,
            name: incomingName,
            content: params.entry.source.content,
        })
    }

    await setAgentPresetOrigin(params.ownerId, written.id, origin)
    const record = await readAgent(params.ownerId, written.id)
    return { ok: true, agents: [toAgentDto(record)] }
}
