import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { syncActiveCodexConnectionSkills } from '@/lib/server/codex-skill-sync'
import { importSkillBundleForOwner } from '@/lib/server/skill-preset-helpers'
import { loadBuiltinSkillPreset } from '@/skill-presets'

interface RouteParams {
    params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const preset = loadBuiltinSkillPreset(id)
        if (!preset) {
            return NextResponse.json({ detail: 'Preset not found.' }, { status: 404 })
        }

        const body = (await request.json().catch(() => null)) as { overwriteExisting?: unknown } | null
        const overwriteExisting = body?.overwriteExisting === true

        const imported = await importSkillBundleForOwner({
            ownerId: user.userId,
            bundle: preset.bundle,
            overwriteExisting,
            sourcePresetId: preset.metadata.presetId,
            sourcePresetRevision: preset.metadata.revision,
        })

        if (!imported.ok) {
            return NextResponse.json(
                {
                    detail: imported.detail,
                    ...(imported.code ? { code: imported.code } : {}),
                    ...(imported.names ? { names: imported.names } : {}),
                },
                { status: imported.status }
            )
        }

        await syncActiveCodexConnectionSkills(user.userId)

        return NextResponse.json(
            {
                presetId: preset.metadata.presetId,
                skills: imported.skills,
            },
            { status: 201 }
        )
    } catch (error) {
        console.error('Clone skill preset error:', error)
        const detail = error instanceof Error ? error.message : 'Internal server error'
        return NextResponse.json({ detail }, { status: 500 })
    }
}
