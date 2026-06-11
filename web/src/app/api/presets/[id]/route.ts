import { mkdir, writeFile } from 'node:fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isPresetAuthoringEnabled } from '@/lib/preset-authoring'
import { serializePromptPresetJson } from '@/lib/prompt-preset'
import { buildPromptPresetAssetFromOwnedPrompt } from '@/lib/server/prompt-preset-helpers'
import { loadBuiltinPromptPresetRegistryEntry, BUILTIN_PROMPT_PRESET_ASSET_DIR } from '@/presets'

interface RouteParams {
    params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params
    const entry = loadBuiltinPromptPresetRegistryEntry(id)
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
        if (!('prompt' in (prisma as unknown as Record<string, unknown>))) {
            return NextResponse.json({ detail: 'Prisma client is out of date. Run `prisma generate`.' }, { status: 500 })
        }

        const { id } = await params
        const entry = loadBuiltinPromptPresetRegistryEntry(id)
        if (!entry) {
            return NextResponse.json({ detail: 'Preset not found.' }, { status: 404 })
        }

        const body = (await request.json().catch(() => null)) as
            | {
                  promptId?: unknown
                  name?: unknown
                  description?: unknown
              }
            | null

        const promptId = typeof body?.promptId === 'string' ? body.promptId.trim() : ''
        const name = typeof body?.name === 'string' ? body.name.trim() : entry.summary.name
        const description = body?.description === undefined
            ? entry.summary.description
            : body.description === null
                ? null
                : typeof body.description === 'string'
                    ? body.description.trim() || null
                    : entry.summary.description

        if (!promptId) {
            return NextResponse.json({ detail: 'promptId is required.' }, { status: 400 })
        }
        if (!name) {
            return NextResponse.json({ detail: 'Preset name is required.' }, { status: 400 })
        }

        const built = await buildPromptPresetAssetFromOwnedPrompt({
            prisma: prisma as typeof prisma,
            userId: user.userId,
            promptId,
            presetId: entry.summary.presetId,
            name,
            description,
            revision: Math.round((entry.summary.revision + 0.1) * 10) / 10,
        })
        if (!built.ok) {
            return NextResponse.json({ detail: built.detail }, { status: built.status })
        }

        await mkdir(BUILTIN_PROMPT_PRESET_ASSET_DIR, { recursive: true })
        await writeFile(entry.assetFilePath, `${serializePromptPresetJson(built.preset)}\n`, 'utf8')

        return NextResponse.json({
            presetId: built.preset.metadata.presetId,
            revision: built.preset.metadata.revision,
            preset: built.preset,
        })
    } catch (error) {
        console.error('Update prompt preset error:', error)
        const detail = error instanceof Error ? error.message : 'Internal server error'
        return NextResponse.json({ detail }, { status: 500 })
    }
}
