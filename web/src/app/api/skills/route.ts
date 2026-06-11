import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { normalizeSkillCategory } from '@/lib/skills'
import { syncActiveCodexConnectionSkills } from '@/lib/server/codex-skill-sync'
import { createSkill, getSkillValidationErrorDetail, listSkills, toSkillDto } from '@/lib/server/skill-storage'

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const categoryRaw = searchParams.get('category')
        const category = categoryRaw ? normalizeSkillCategory(categoryRaw) : null
        if (categoryRaw && !category) {
            return NextResponse.json({ detail: 'Invalid category' }, { status: 400 })
        }

        const skills = await listSkills(user.userId)
        const filtered = category ? skills.filter((skill) => skill.category === category) : skills
        return NextResponse.json({ skills: filtered.map(toSkillDto) })
    } catch (error) {
        console.error('List skills error:', error)
        return NextResponse.json({ detail: getSkillValidationErrorDetail(error) }, { status: 500 })
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
        const category = normalizeSkillCategory(body?.category)

        if (!name) {
            return NextResponse.json({ detail: 'Name is required' }, { status: 400 })
        }
        if (!category) {
            return NextResponse.json({ detail: 'Invalid category' }, { status: 400 })
        }

        const skill = await createSkill({
            ownerId: user.userId,
            name,
            category,
        })
        await syncActiveCodexConnectionSkills(user.userId)

        return NextResponse.json({ skill: toSkillDto(skill) }, { status: 201 })
    } catch (error) {
        console.error('Create skill error:', error)
        return NextResponse.json({ detail: getSkillValidationErrorDetail(error) }, { status: 500 })
    }
}
