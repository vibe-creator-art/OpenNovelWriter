import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { loadBuiltinPromptPreset } from '@/presets'
import { importPromptBundleForOwner } from '@/lib/server/prompt-preset-helpers'

interface RouteParams {
    params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }
        if (!('prompt' in (prisma as unknown as Record<string, unknown>))) {
            return NextResponse.json({ detail: 'Prisma client is out of date. Run `prisma generate`.' }, { status: 500 })
        }

        const { id } = await params
        const preset = loadBuiltinPromptPreset(id)
        if (!preset) {
            return NextResponse.json({ detail: 'Preset not found.' }, { status: 404 })
        }

        const body = (await request.json().catch(() => null)) as { overwriteExisting?: unknown } | null
        const overwriteExisting = body?.overwriteExisting === true

        const imported = await prisma.$transaction((tx) =>
            importPromptBundleForOwner({
                prisma: tx,
                userId: user.userId,
                bundle: preset.bundle,
                overwriteExisting,
            })
        )

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
                presetId: preset.metadata.presetId,
                prompts: imported.prompts,
            },
            { status: 201 }
        )
    } catch (error) {
        console.error('Clone prompt preset error:', error)
        const detail = error instanceof Error ? error.message : 'Internal server error'
        return NextResponse.json({ detail }, { status: 500 })
    }
}
