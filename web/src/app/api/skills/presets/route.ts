import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { isPresetAuthoringEnabled } from '@/lib/preset-authoring'
import { listBuiltinSkillPresetRegistryEntries } from '@/skill-presets'
import { toBuiltinSkillPresetPayload } from '@/app/api/skills/presets/_helpers'

export async function GET(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const presets = listBuiltinSkillPresetRegistryEntries().map(toBuiltinSkillPresetPayload)

    return NextResponse.json({
        authoringEnabled: isPresetAuthoringEnabled(),
        presets,
    })
}
