import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { issuePasswordResetCode, printPasswordResetCode } from '@/lib/server/password-reset'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const username = typeof body?.username === 'string' ? body.username.trim() : ''
        if (!username) {
            return NextResponse.json({ detail: 'missing_fields' }, { status: 400 })
        }

        const user = await prisma.user.findUnique({
            where: { username },
            select: { id: true, isActive: true },
        })
        if (!user || !user.isActive) {
            return NextResponse.json({ detail: 'user_not_found' }, { status: 404 })
        }

        const code = issuePasswordResetCode(username)
        printPasswordResetCode(username, code)
        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('Forgot password error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
