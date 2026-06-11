import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword, generateToken } from '@/lib/auth'
import { isRegistrationEnabled } from '@/lib/registration'

export async function POST(request: NextRequest) {
    try {
        if (!isRegistrationEnabled()) {
            return NextResponse.json(
                { detail: 'Registration is closed' },
                { status: 403 }
            )
        }

        const body = await request.json()
        const { username, email, password } = body

        // Validate required fields
        if (!username || !email || !password) {
            return NextResponse.json(
                { detail: 'Missing required fields: username, email, password' },
                { status: 400 }
            )
        }

        // Check if user already exists
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { username },
                    { email },
                ],
            },
        })

        if (existingUser) {
            return NextResponse.json(
                { detail: 'Username or email already registered' },
                { status: 400 }
            )
        }

        // Hash password and create user
        const hashedPassword = await hashPassword(password)
        const user = await prisma.user.create({
            data: {
                username,
                email,
                password: hashedPassword,
            },
        })

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
        console.error('Registration error:', error)
        return NextResponse.json(
            { detail: 'Internal server error' },
            { status: 500 }
        )
    }
}
