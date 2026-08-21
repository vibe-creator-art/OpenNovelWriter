import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateToken, hashPassword } from '@/lib/auth'
import { consumePasswordResetCode } from '@/lib/server/password-reset'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const username = typeof body?.username === 'string' ? body.username.trim() : ''
        const code = typeof body?.code === 'string' ? body.code.trim() : ''
        const password = typeof body?.password === 'string' ? body.password : ''
        if (!username || !code || !password) {
            return NextResponse.json({ detail: 'missing_fields' }, { status: 400 })
        }
        if (password.length < 6) {
            return NextResponse.json({ detail: 'password_too_short' }, { status: 400 })
        }

        const result = consumePasswordResetCode(username, code)
        if (result === 'expired') {
            return NextResponse.json({ detail: 'expired_code' }, { status: 400 })
        }
        if (result !== 'ok') {
            return NextResponse.json({ detail: 'invalid_code' }, { status: 400 })
        }

        const user = await prisma.user.findUnique({
            where: { username },
        })
        if (!user || !user.isActive) {
            return NextResponse.json({ detail: 'user_not_found' }, { status: 404 })
        }

        const hashedPassword = await hashPassword(password)
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword },
        })

        const token = generateToken({
            userId: user.id,
            username: user.username,
            email: user.email,
        })
        return NextResponse.json({
            access_token: token,
            token_type: 'bearer',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
            },
        })
    } catch (error) {
        console.error('Reset password error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
