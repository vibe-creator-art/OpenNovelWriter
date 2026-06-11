import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { createAgent, getAgentValidationErrorDetail, listAgents, toAgentDto } from '@/lib/server/agent-storage'

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const agents = await listAgents(user.userId)
        return NextResponse.json({ agents: agents.map(toAgentDto) })
    } catch (error) {
        console.error('List agents error:', error)
        return NextResponse.json({ detail: getAgentValidationErrorDetail(error) }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const body = await request.json().catch(() => null)
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        if (!name) {
            return NextResponse.json({ detail: 'Name is required' }, { status: 400 })
        }

        const agent = await createAgent({
            ownerId: user.userId,
            name,
        })

        return NextResponse.json({ agent: toAgentDto(agent) }, { status: 201 })
    } catch (error) {
        console.error('Create agent error:', error)
        return NextResponse.json({ detail: getAgentValidationErrorDetail(error) }, { status: 500 })
    }
}
