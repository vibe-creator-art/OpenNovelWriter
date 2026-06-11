import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production'
const JWT_EXPIRES_IN = '7d'

export interface JWTPayload {
    userId: string
    username: string
    email: string
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12)
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword)
}

/**
 * Generate a JWT token
 */
export function generateToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as JWTPayload
    } catch {
        return null
    }
}

/**
 * Extract the JWT token from the Authorization header
 */
export function getTokenFromRequest(request: NextRequest): string | null {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
        return null
    }
    return authHeader.slice(7)
}

/**
 * Get the current user from a request
 */
export async function getCurrentUser(request: NextRequest): Promise<JWTPayload | null> {
    const token = getTokenFromRequest(request)
    if (!token) return null
    const payload = verifyToken(token)
    if (!payload) return null

    const user = await prisma.user.findFirst({
        where: { id: payload.userId, isActive: true },
        select: { id: true },
    })

    if (!user) return null
    return payload
}
