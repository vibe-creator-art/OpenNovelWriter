import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { isPresetAuthoringEnabled } from '@/lib/preset-authoring'
import { createSkillPresetKey, serializeSkillPresetJson } from '@/lib/skill-preset'
import { buildSkillPresetAssetFromOwnedSkill } from '@/lib/server/skill-preset-helpers'
import { loadBuiltinSkillPresetRegistryEntry, BUILTIN_SKILL_PRESET_ASSET_DIR } from '@/skill-presets'

function getPresetAssetFilePath(presetId: string) {
    return join(BUILTIN_SKILL_PRESET_ASSET_DIR, `${presetId}.json`)
}

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }
        if (!isPresetAuthoringEnabled()) {
            return NextResponse.json({ detail: 'Preset authoring is disabled.' }, { status: 403 })
        }

        const body = (await request.json().catch(() => null)) as
            | {
                  skillId?: unknown
                  name?: unknown
                  description?: unknown
              }
            | null

        const skillId = typeof body?.skillId === 'string' ? body.skillId.trim() : ''
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        const description = body?.description === null ? null : typeof body?.description === 'string' ? body.description.trim() || null : null

        if (!skillId) {
            return NextResponse.json({ detail: 'skillId is required.' }, { status: 400 })
        }
        if (!name) {
            return NextResponse.json({ detail: 'Preset name is required.' }, { status: 400 })
        }

        const normalizedPresetId = createSkillPresetKey(name)
        if (loadBuiltinSkillPresetRegistryEntry(normalizedPresetId)) {
            return NextResponse.json({ detail: 'Preset id already exists.' }, { status: 409 })
        }

        const built = await buildSkillPresetAssetFromOwnedSkill({
            ownerId: user.userId,
            skillId,
            presetId: normalizedPresetId,
            name,
            description,
            revision: 1,
        })
        if (!built.ok) {
            return NextResponse.json({ detail: built.detail }, { status: built.status })
        }

        await mkdir(BUILTIN_SKILL_PRESET_ASSET_DIR, { recursive: true })
        await writeFile(getPresetAssetFilePath(normalizedPresetId), `${serializeSkillPresetJson(built.preset)}\n`, 'utf8')

        return NextResponse.json(
            {
                presetId: built.preset.metadata.presetId,
                revision: built.preset.metadata.revision,
                preset: built.preset,
            },
            { status: 201 }
        )
    } catch (error) {
        console.error('Publish skill preset error:', error)
        const detail = error instanceof Error ? error.message : 'Internal server error'
        return NextResponse.json({ detail }, { status: 500 })
    }
}
