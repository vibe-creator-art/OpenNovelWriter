import {
    SKILL_BUNDLE_SCHEMA,
    SKILL_BUNDLE_VERSION,
    SKILL_PRESET_SCHEMA,
    SKILL_PRESET_VERSION,
    type SkillBundleV1,
    type SkillPresetAssetV1,
} from '@/lib/skill-preset'
import {
    createSkillFromContent,
    listSkills,
    parseSkillContent,
    readSkill,
    setSkillPresetOrigin,
    toSkillDto,
    updateSkill,
} from '@/lib/server/skill-storage'

function normalizeNameKey(value: string) {
    return value.trim().toLowerCase()
}

export async function buildSkillPresetAssetFromOwnedSkill(params: {
    ownerId: string
    skillId: string
    presetId: string
    name: string
    description: string | null
    revision: number
}): Promise<{ ok: true; preset: SkillPresetAssetV1 } | { ok: false; status: number; detail: string }> {
    const skill = await readSkill(params.ownerId, params.skillId).catch(() => null)
    if (!skill) return { ok: false, status: 404, detail: 'Skill not found.' }

    const exportedAt = new Date().toISOString()
    const bundle: SkillBundleV1 = {
        schema: SKILL_BUNDLE_SCHEMA,
        version: SKILL_BUNDLE_VERSION,
        exportedAt,
        entryName: skill.name,
        skills: [
            {
                name: skill.name,
                description: skill.description,
                category: skill.category,
                prompt: skill.prompt,
                content: skill.content,
            },
        ],
    }

    return {
        ok: true,
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
            bundle,
        },
    }
}

export async function importSkillBundleForOwner(params: {
    ownerId: string
    bundle: SkillBundleV1
    overwriteExisting: boolean
    sourcePresetId?: string | null
    sourcePresetRevision?: number | null
}): Promise<
    | { ok: true; skills: ReturnType<typeof toSkillDto>[] }
    | { ok: false; status: number; detail: string; code?: string; names?: string[] }
> {
    const incoming: Array<{ name: string; content: string }> = []
    for (const skill of params.bundle.skills) {
        const content = typeof skill.content === 'string' ? skill.content : ''
        if (!content.trim()) return { ok: false, status: 400, detail: 'Skill content is required.' }

        let name: string
        try {
            name = parseSkillContent(content).name
        } catch (error) {
            return { ok: false, status: 400, detail: error instanceof Error ? error.message : 'Invalid skill content.' }
        }
        incoming.push({ name, content })
    }

    const existing = await listSkills(params.ownerId)
    const existingByNameKey = new Map(existing.map((skill) => [normalizeNameKey(skill.name), skill]))

    const incomingKeys = new Set<string>()
    const duplicateIncomingNames: string[] = []
    const conflictingNames: string[] = []
    for (const skill of incoming) {
        const key = normalizeNameKey(skill.name)
        if (!key) continue
        if (incomingKeys.has(key)) duplicateIncomingNames.push(skill.name)
        incomingKeys.add(key)
        if (existingByNameKey.has(key)) conflictingNames.push(skill.name)
    }

    if (duplicateIncomingNames.length > 0) {
        return {
            ok: false,
            status: 400,
            detail: 'Duplicate skill names in preset.',
            code: 'SKILL_PRESET_DUPLICATE_NAMES',
            names: [...new Set(duplicateIncomingNames.map((n) => n.trim()).filter(Boolean))],
        }
    }

    if (conflictingNames.length > 0 && !params.overwriteExisting) {
        const unique = [...new Set(conflictingNames.map((n) => n.trim()).filter(Boolean))]
        const list = unique.slice(0, 8).join(', ')
        const suffix = unique.length > 8 ? ` (+${unique.length - 8} more)` : ''
        return {
            ok: false,
            status: 409,
            detail: `Skill name already exists: ${list}${suffix}`,
            code: 'SKILL_NAME_ALREADY_EXISTS',
            names: unique,
        }
    }

    const origin = params.sourcePresetId
        ? { presetId: params.sourcePresetId, revision: params.sourcePresetRevision ?? 1 }
        : null

    const records = []
    for (const skill of incoming) {
        const existingSkill = existingByNameKey.get(normalizeNameKey(skill.name)) ?? null
        const written = existingSkill && params.overwriteExisting
            ? await updateSkill({ ownerId: params.ownerId, skillId: existingSkill.id, content: skill.content })
            : await createSkillFromContent({ ownerId: params.ownerId, content: skill.content })
        // Record origin out-of-band so the cloned skill is locked, then re-read to reflect it in the DTO.
        await setSkillPresetOrigin(params.ownerId, written.id, origin)
        records.push(origin ? await readSkill(params.ownerId, written.id) : written)
    }

    return { ok: true, skills: records.map(toSkillDto) }
}
