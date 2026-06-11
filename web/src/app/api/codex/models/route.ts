import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { fetchModelsForProvider } from '@/lib/server/ai-providers'

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const apiKey = String(body?.apiKey || '').trim()
        const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''

        if (!apiKey) {
            return NextResponse.json({ detail: 'Missing API key.' }, { status: 400 })
        }

        const models = await fetchModelsForProvider({
            providerType: 'openai-chat',
            apiKey,
            baseUrl,
        })

        return NextResponse.json({ models })
    } catch (error) {
        console.error('Failed to fetch Codex custom models:', error)
        const message = error instanceof Error ? error.message : 'Failed to fetch models.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to fetch models.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
