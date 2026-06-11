import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import {
    AgentNotFoundError,
    deleteAgent,
    DuplicateAgentNameError,
    getAgentValidationErrorDetail,
    readAgent,
    toAgentDto,
    updateAgent,
} from '@/lib/server/agent-storage'

interface RouteParams {
    params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const agent = await readAgent(user.userId, id)
        return NextResponse.json({ agent: toAgentDto(agent) })
    } catch (error) {
        console.error('Get agent error:', error)
        const status = error instanceof AgentNotFoundError ? 404 : 500
        return NextResponse.json({ detail: getAgentValidationErrorDetail(error) }, { status })
    }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json().catch(() => null)
        const name = typeof body?.name === 'string' ? body.name : undefined
        const content = typeof body?.content === 'string' ? body.content : undefined
        const enabled = typeof body?.enabled === 'boolean' ? body.enabled : undefined

        if (name === undefined && content === undefined && enabled === undefined) {
            return NextResponse.json({ detail: 'No updates provided' }, { status: 400 })
        }

        const agent = await updateAgent({
            ownerId: user.userId,
            agentId: id,
            name,
            content,
            enabled,
        })

        return NextResponse.json({ agent: toAgentDto(agent) })
    } catch (error) {
        console.error('Update agent error:', error)
        const status =
            error instanceof DuplicateAgentNameError
                ? 409
                : error instanceof AgentNotFoundError
                    ? 404
                    : 400
        return NextResponse.json({ detail: getAgentValidationErrorDetail(error) }, { status })
    }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        await deleteAgent(user.userId, id)
        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Delete agent error:', error)
        const status = error instanceof AgentNotFoundError ? 404 : 500
        return NextResponse.json({ detail: getAgentValidationErrorDetail(error) }, { status })
    }
}
