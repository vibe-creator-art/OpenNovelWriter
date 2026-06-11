import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { syncActiveCodexConnectionSkills } from '@/lib/server/codex-skill-sync'
import {
    deleteSkill,
    DuplicateSkillNameError,
    getSkillValidationErrorDetail,
    readSkill,
    setSkillEnabled,
    SkillNotFoundError,
    toSkillDto,
    updateSkill,
} from '@/lib/server/skill-storage'

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
        const skill = await readSkill(user.userId, id)
        return NextResponse.json({ skill: toSkillDto(skill) })
    } catch (error) {
        console.error('Get skill error:', error)
        const status = error instanceof SkillNotFoundError ? 404 : 500
        return NextResponse.json({ detail: getSkillValidationErrorDetail(error) }, { status })
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
        const content = typeof body?.content === 'string' ? body.content : ''
        if (!content.trim()) {
            return NextResponse.json({ detail: 'Content is required' }, { status: 400 })
        }

        const skill = await updateSkill({
            ownerId: user.userId,
            skillId: id,
            content,
        })
        await syncActiveCodexConnectionSkills(user.userId)

        return NextResponse.json({ skill: toSkillDto(skill) })
    } catch (error) {
        console.error('Update skill error:', error)
        const status =
            error instanceof DuplicateSkillNameError
                ? 409
                : error instanceof SkillNotFoundError
                    ? 404
                    : 400
        return NextResponse.json({ detail: getSkillValidationErrorDetail(error) }, { status })
    }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json().catch(() => null)
        if (typeof body?.enabled !== 'boolean') {
            return NextResponse.json({ detail: '`enabled` (boolean) is required' }, { status: 400 })
        }

        const skill = await setSkillEnabled(user.userId, id, body.enabled)
        await syncActiveCodexConnectionSkills(user.userId)

        return NextResponse.json({ skill: toSkillDto(skill) })
    } catch (error) {
        console.error('Toggle skill enabled error:', error)
        const status = error instanceof SkillNotFoundError ? 404 : 400
        return NextResponse.json({ detail: getSkillValidationErrorDetail(error) }, { status })
    }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { id } = await params
        await deleteSkill(user.userId, id)
        await syncActiveCodexConnectionSkills(user.userId)
        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Delete skill error:', error)
        const status = error instanceof SkillNotFoundError ? 404 : 500
        return NextResponse.json({ detail: getSkillValidationErrorDetail(error) }, { status })
    }
}
