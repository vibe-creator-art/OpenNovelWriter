import { mkdir, writeFile } from 'node:fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { isPresetAuthoringEnabled } from '@/lib/preset-authoring'
import { getNextSkillPresetRevision, serializeSkillPresetJson } from '@/lib/skill-preset'
import { buildSkillPresetAssetFromOwnedSkill } from '@/lib/server/skill-preset-helpers'
import { loadBuiltinSkillPresetRegistryEntry, BUILTIN_SKILL_PRESET_ASSET_DIR } from '@/skill-presets'

interface RouteParams {
    params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params
    const entry = loadBuiltinSkillPresetRegistryEntry(id)
    if (!entry) {
        return NextResponse.json({ detail: 'Preset not found.' }, { status: 404 })
    }

    return NextResponse.json({ preset: entry.preset })
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }
        if (!isPresetAuthoringEnabled()) {
            return NextResponse.json({ detail: 'Preset authoring is disabled.' }, { status: 403 })
        }

        const { id } = await params
        const entry = loadBuiltinSkillPresetRegistryEntry(id)
        if (!entry) {
            return NextResponse.json({ detail: 'Preset not found.' }, { status: 404 })
        }

        const body = (await request.json().catch(() => null)) as
            | {
                  skillId?: unknown
                  name?: unknown
                  description?: unknown
              }
            | null

        const skillId = typeof body?.skillId === 'string' ? body.skillId.trim() : ''
        const name = typeof body?.name === 'string' ? body.name.trim() : entry.summary.name
        const description = body?.description === undefined
            ? entry.summary.description
            : body.description === null
                ? null
                : typeof body.description === 'string'
                    ? body.description.trim() || null
                    : entry.summary.description

        if (!skillId) {
            return NextResponse.json({ detail: 'skillId is required.' }, { status: 400 })
        }
        if (!name) {
            return NextResponse.json({ detail: 'Preset name is required.' }, { status: 400 })
        }

        const built = await buildSkillPresetAssetFromOwnedSkill({
            ownerId: user.userId,
            skillId,
            presetId: entry.summary.presetId,
            name,
            description,
            revision: getNextSkillPresetRevision(entry.summary.revision),
        })
        if (!built.ok) {
            return NextResponse.json({ detail: built.detail }, { status: built.status })
        }

        await mkdir(BUILTIN_SKILL_PRESET_ASSET_DIR, { recursive: true })
        await writeFile(entry.assetFilePath, `${serializeSkillPresetJson(built.preset)}\n`, 'utf8')

        return NextResponse.json({
            presetId: built.preset.metadata.presetId,
            revision: built.preset.metadata.revision,
            preset: built.preset,
        })
    } catch (error) {
        console.error('Update skill preset error:', error)
        const detail = error instanceof Error ? error.message : 'Internal server error'
        return NextResponse.json({ detail }, { status: 500 })
    }
}
