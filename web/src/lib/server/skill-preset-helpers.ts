import fs from 'fs/promises'
import path from 'path'

import {
    SKILL_PRESET_SCHEMA,
    SKILL_PRESET_VERSION,
    serializeSkillPresetJson,
    type SkillPresetAssetV1,
} from '@/lib/skill-preset'
import type { BuiltinSkillPresetRegistryEntry } from '@/skill-presets'
import {
    copySkillDirectory,
    createSkillFromDirectory,
    getOwnedSkillDirectory,
    listSkills,
    readSkill,
    replaceSkillFromDirectory,
    setSkillPresetOrigin,
    toSkillDto,
} from '@/lib/server/skill-storage'

function normalizeNameKey(value: string) {
    return value.trim().toLowerCase()
}

export type BuiltOwnedSkillPreset = {
    preset: SkillPresetAssetV1
    sourceDirectory: string
}

export async function buildSkillPresetAssetFromOwnedSkill(params: {
    ownerId: string
    skillId: string
    presetId: string
    name: string
    description: string | null
    revision: number
}): Promise<{ ok: true; built: BuiltOwnedSkillPreset } | { ok: false; status: number; detail: string }> {
    const skill = await readSkill(params.ownerId, params.skillId).catch(() => null)
    if (!skill) return { ok: false, status: 404, detail: 'Skill not found.' }

    const exportedAt = new Date().toISOString()
    return {
        ok: true,
        built: {
            preset: {
                schema: SKILL_PRESET_SCHEMA,
                version: SKILL_PRESET_VERSION,
                metadata: {
                    presetId: params.presetId,
                    name: params.name,
                    description: params.description,
                    revision: params.revision,
                    exportedAt,
                },
                entrySkill: 'skill',
                skills: ['skill'],
            },
            sourceDirectory: getOwnedSkillDirectory(params.ownerId, params.skillId),
        },
    }
}

/** Write the manifest and complete skill folder as one replaceable preset directory. */
export async function writeSkillPresetDirectory(params: {
    assetDirectoryPath: string
    built: BuiltOwnedSkillPreset
    replaceExisting: boolean
}) {
    const parent = path.dirname(params.assetDirectoryPath)
    await fs.mkdir(parent, { recursive: true })
    const baseName = path.basename(params.assetDirectoryPath)
    const staging = path.join(parent, `.${baseName}.staging-${crypto.randomUUID()}`)
    const backup = path.join(parent, `.${baseName}.backup-${crypto.randomUUID()}`)
    await fs.mkdir(staging)
    try {
        await copySkillDirectory(params.built.sourceDirectory, path.join(staging, 'skill'))
        await fs.writeFile(
            path.join(staging, 'preset.json'),
            `${serializeSkillPresetJson(params.built.preset)}\n`,
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

export async function importSkillPresetForOwner(params: {
    ownerId: string
    entry: BuiltinSkillPresetRegistryEntry
    overwriteExisting: boolean
}): Promise<
    | { ok: true; skills: ReturnType<typeof toSkillDto>[] }
    | { ok: false; status: number; detail: string; code?: string; names?: string[] }
> {
    const existing = await listSkills(params.ownerId)
    const existingByNameKey = new Map(existing.map((skill) => [normalizeNameKey(skill.name), skill]))
    const incomingKeys = new Set<string>()
    const duplicateIncomingNames: string[] = []
    const conflictingNames: string[] = []

    for (const skill of params.entry.skills) {
        const key = normalizeNameKey(skill.name)
        if (incomingKeys.has(key)) duplicateIncomingNames.push(skill.name)
        incomingKeys.add(key)
        if (existingByNameKey.has(key)) conflictingNames.push(skill.name)
    }

    if (duplicateIncomingNames.length > 0) {
        const names = [...new Set(duplicateIncomingNames)]
        return { ok: false, status: 400, detail: 'Duplicate skill names in preset.', code: 'SKILL_PRESET_DUPLICATE_NAMES', names }
    }
    if (conflictingNames.length > 0 && !params.overwriteExisting) {
        const names = [...new Set(conflictingNames)]
        const list = names.slice(0, 8).join(', ')
        const suffix = names.length > 8 ? ` (+${names.length - 8} more)` : ''
        return {
            ok: false,
            status: 409,
            detail: `Skill name already exists: ${list}${suffix}`,
            code: 'SKILL_NAME_ALREADY_EXISTS',
            names,
        }
    }

    const origin = {
        presetId: params.entry.preset.metadata.presetId,
        revision: params.entry.preset.metadata.revision,
    }
    const records = []
    for (const source of params.entry.skills) {
        const existingSkill = existingByNameKey.get(normalizeNameKey(source.name)) ?? null
        const written = existingSkill && params.overwriteExisting
            ? await replaceSkillFromDirectory({
                ownerId: params.ownerId,
                skillId: existingSkill.id,
                sourceDirectory: source.directoryPath,
            })
            : await createSkillFromDirectory({ ownerId: params.ownerId, sourceDirectory: source.directoryPath })
        await setSkillPresetOrigin(params.ownerId, written.id, origin)
        records.push(await readSkill(params.ownerId, written.id))
    }

    return { ok: true, skills: records.map(toSkillDto) }
}
