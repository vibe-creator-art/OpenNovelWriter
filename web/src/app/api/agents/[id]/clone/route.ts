import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import {
    AgentNotFoundError,
    cloneAgent,
    getAgentValidationErrorDetail,
    toAgentDto,
} from '@/lib/server/agent-storage'

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
        const agent = await cloneAgent({ ownerId: user.userId, agentId: id })

        return NextResponse.json({ agent: toAgentDto(agent) }, { status: 201 })
    } catch (error) {
        console.error('Clone agent error:', error)
        const status = error instanceof AgentNotFoundError ? 404 : 500
        return NextResponse.json({ detail: getAgentValidationErrorDetail(error) }, { status })
    }
}
