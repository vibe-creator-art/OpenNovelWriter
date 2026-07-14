import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { ensureCodexConnectionHome } from '@/lib/server/codex-connection-storage'
import { listCodexModels } from '@/lib/server/codex-app-server'
import { expandNativeCodexModels, parseCodexProviderModelsJson } from '@/lib/codex-config'

const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const { id } = await context.params
    const connection = await prisma.codexConnection.findFirst({
        where: { id, ownerId: user.userId },
    })
    if (!connection) return NextResponse.json({ detail: 'Not found' }, { status: 404 })

    try {
        if (connection.providerType === 'custom') {
            return NextResponse.json({
                models: expandNativeCodexModels(parseCodexProviderModelsJson(connection.modelsJson)).map((model) => ({
                    id: model.id,
                    displayName: model.displayName,
                    description: model.displayName,
                    supportedReasoningEfforts: model.supportedReasoningEfforts,
                    defaultReasoningEffort: model.defaultReasoningEffort,
                    serviceTiers: [],
                })),
            })
        }
        const codexHome = await ensureCodexConnectionHome(user.userId, connection.id)
        return NextResponse.json({ models: await listCodexModels(codexHome) })
    } catch (error) {
        console.error('List Codex app-server models error:', error)
        return NextResponse.json({ detail: 'Failed to load Codex models.' }, { status: 500 })
    }
}
