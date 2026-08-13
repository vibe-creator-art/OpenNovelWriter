import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { isPresetAuthoringEnabled } from '@/lib/preset-authoring'
import { listBuiltinAgentPresetRegistryEntries } from '@/agent-presets'
import { toBuiltinAgentPresetPayload } from '@/app/api/agents/presets/_helpers'

export async function GET(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const presets = listBuiltinAgentPresetRegistryEntries().map(toBuiltinAgentPresetPayload)

    return NextResponse.json({
        authoringEnabled: isPresetAuthoringEnabled(),
        presets,
    })
}
