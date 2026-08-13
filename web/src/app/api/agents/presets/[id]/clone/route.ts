import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { importAgentPresetForOwner } from '@/lib/server/agent-preset-helpers'
import { loadBuiltinAgentPresetRegistryEntry } from '@/agent-presets'

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
        const entry = loadBuiltinAgentPresetRegistryEntry(id)
        if (!entry) {
            return NextResponse.json({ detail: 'Preset not found.' }, { status: 404 })
        }

        const body = (await request.json().catch(() => null)) as { overwriteExisting?: unknown } | null
        const overwriteExisting = body?.overwriteExisting === true

        const imported = await importAgentPresetForOwner({
            ownerId: user.userId,
            entry,
            overwriteExisting,
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

        return NextResponse.json(
            {
                presetId: entry.preset.metadata.presetId,
                agents: imported.agents,
            },
            { status: 201 }
        )
    } catch (error) {
        console.error('Clone agent preset error:', error)
        const detail = error instanceof Error ? error.message : 'Internal server error'
        return NextResponse.json({ detail }, { status: 500 })
    }
}
