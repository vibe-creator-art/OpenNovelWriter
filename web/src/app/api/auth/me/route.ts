import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(request: NextRequest) {
    try {
        const payload = await getCurrentUser(request)

        if (!payload) {
            return NextResponse.json(
                { detail: 'Not authenticated' },
                { status: 401 }
            )
        }

        // Get fresh user data from database
        const user = await prisma.user.findUnique({
            where: { id: payload.userId },
            select: {
                id: true,
                username: true,
                email: true,
                isActive: true,
                createdAt: true,
            },
        })

        if (!user || !user.isActive) {
            return NextResponse.json(
                { detail: 'User not found or inactive' },
                { status: 401 }
            )
        }

        return NextResponse.json(user)
    } catch (error) {
        console.error('Get user error:', error)
        return NextResponse.json(
            { detail: 'Internal server error' },
            { status: 500 }
        )
    }
}
