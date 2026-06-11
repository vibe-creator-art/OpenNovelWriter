import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isPresetAuthoringEnabled } from '@/lib/preset-authoring'
import { createPromptPresetKey, serializePromptPresetJson } from '@/lib/prompt-preset'
import { buildPromptPresetAssetFromOwnedPrompt } from '@/lib/server/prompt-preset-helpers'
import { loadBuiltinPromptPresetRegistryEntry, BUILTIN_PROMPT_PRESET_ASSET_DIR } from '@/presets'

function getPresetAssetFilePath(presetId: string) {
    return join(BUILTIN_PROMPT_PRESET_ASSET_DIR, `${presetId}.json`)
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
        if (!('prompt' in (prisma as unknown as Record<string, unknown>))) {
            return NextResponse.json({ detail: 'Prisma client is out of date. Run `prisma generate`.' }, { status: 500 })
        }

        const body = (await request.json().catch(() => null)) as
            | {
                  promptId?: unknown
                  presetId?: unknown
                  name?: unknown
                  description?: unknown
              }
            | null

        const promptId = typeof body?.promptId === 'string' ? body.promptId.trim() : ''
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        const description = body?.description === null ? null : typeof body?.description === 'string' ? body.description.trim() || null : null

        if (!promptId) {
            return NextResponse.json({ detail: 'promptId is required.' }, { status: 400 })
        }
        if (!name) {
            return NextResponse.json({ detail: 'Preset name is required.' }, { status: 400 })
        }

        const normalizedPresetId = createPromptPresetKey(name)
        if (loadBuiltinPromptPresetRegistryEntry(normalizedPresetId)) {
            return NextResponse.json({ detail: 'Preset id already exists.' }, { status: 409 })
        }

        const built = await buildPromptPresetAssetFromOwnedPrompt({
            prisma: prisma as typeof prisma,
            userId: user.userId,
            promptId,
            presetId: normalizedPresetId,
            name,
            description,
            revision: 1,
        })
        if (!built.ok) {
            return NextResponse.json({ detail: built.detail }, { status: built.status })
        }

        await mkdir(BUILTIN_PROMPT_PRESET_ASSET_DIR, { recursive: true })
        await writeFile(getPresetAssetFilePath(normalizedPresetId), `${serializePromptPresetJson(built.preset)}\n`, 'utf8')

        return NextResponse.json(
            {
                presetId: built.preset.metadata.presetId,
                revision: built.preset.metadata.revision,
                preset: built.preset,
            },
            { status: 201 }
        )
    } catch (error) {
        console.error('Publish prompt preset error:', error)
        const detail = error instanceof Error ? error.message : 'Internal server error'
        return NextResponse.json({ detail }, { status: 500 })
    }
}
