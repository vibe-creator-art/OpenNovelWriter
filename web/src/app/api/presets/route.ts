import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { isPresetAuthoringEnabled } from '@/lib/preset-authoring'
import { listBuiltinPromptPresetRegistryEntries } from '@/presets'
import { toBuiltinPresetPayload } from '@/app/api/presets/_helpers'

export async function GET(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const presets = listBuiltinPromptPresetRegistryEntries().map(toBuiltinPresetPayload)

    return NextResponse.json({
        authoringEnabled: isPresetAuthoringEnabled(),
        presets,
    })
}
