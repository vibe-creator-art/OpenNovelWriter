import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyPassword, generateToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { username, password } = body

        // Validate required fields
        if (!username || !password) {
            return NextResponse.json(
                { detail: 'Missing required fields: username, password' },
                { status: 400 }
            )
        }

        // Find user by username
        const user = await prisma.user.findUnique({
            where: { username },
        })

        if (!user || !user.isActive) {
            return NextResponse.json(
                { detail: 'Invalid credentials' },
                { status: 401 }
            )
        }

        // Verify password
        const isValidPassword = await verifyPassword(password, user.password)
        if (!isValidPassword) {
            return NextResponse.json(
                { detail: 'Invalid credentials' },
                { status: 401 }
            )
        }

        // Generate token
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
        console.error('Login error:', error)
        return NextResponse.json(
            { detail: 'Internal server error' },
            { status: 500 }
        )
    }
}
