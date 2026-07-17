import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import {
    getSkillValidationErrorDetail,
    listSkillFiles,
    readSkillTextFile,
    SkillNotFoundError,
} from '@/lib/server/skill-storage'

interface RouteParams {
    params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getCurrentUser(request)
        if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

        const { id } = await params
        const filePath = new URL(request.url).searchParams.get('path')
        if (filePath !== null) {
            const file = await readSkillTextFile(user.userId, id, filePath)
            return NextResponse.json(file)
        }

        const files = await listSkillFiles(user.userId, id)
        return NextResponse.json({ files })
    } catch (error) {
        console.error('Browse skill files error:', error)
        const detail = getSkillValidationErrorDetail(error)
        const status = error instanceof SkillNotFoundError
            ? 404
            : /not found/i.test(detail)
                ? 404
                : 400
        return NextResponse.json({ detail }, { status })
    }
}
