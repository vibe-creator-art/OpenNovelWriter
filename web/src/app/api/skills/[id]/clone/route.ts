import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { syncActiveCodexConnectionSkills } from '@/lib/server/codex-skill-sync'
import { cloneSkill, getSkillValidationErrorDetail, SkillNotFoundError, toSkillDto } from '@/lib/server/skill-storage'

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
        const skill = await cloneSkill({ ownerId: user.userId, skillId: id })
        await syncActiveCodexConnectionSkills(user.userId)

        return NextResponse.json({ skill: toSkillDto(skill) }, { status: 201 })
    } catch (error) {
        console.error('Clone skill error:', error)
        const status = error instanceof SkillNotFoundError ? 404 : 500
        return NextResponse.json({ detail: getSkillValidationErrorDetail(error) }, { status })
    }
}
