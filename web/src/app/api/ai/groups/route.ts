import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
    DEFAULT_FAILURE_POLICY,
    DEFAULT_GROUP_SETTINGS,
    normalizeFailurePolicy,
    normalizeGroupModelTypes,
    normalizeGroupSettings,
} from '@/lib/ai-group-config'

const DEFAULT_PRICING_TIERS = [
    {
        id: 'tier-1',
        contextTokensUpTo: null,
        inputPerM: 0,
        outputPerM: 0,
    },
]

const normalizeName = (value: string) => value.trim().toLocaleLowerCase()

async function hasDuplicateGroupName(ownerId: string, name: string, excludeId?: string) {
    const groups = await prisma.aiModelGroup.findMany({
        where: {
            ownerId,
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { name: true },
    })

    const normalizedName = normalizeName(name)
    return groups.some((group) => normalizeName(group.name) === normalizedName)
}

function safeParseJson<T = unknown>(value: string | null | undefined, fallback: T | null = null): T | null {
    if (!value) return fallback
    try {
        return JSON.parse(value) as T
    } catch {
        return fallback
    }
}

export async function GET(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const groups = await prisma.aiModelGroup.findMany({
        where: { ownerId: user.userId },
        orderBy: { sortOrder: 'asc' },
        include: {
            assignments: {
                orderBy: { sortOrder: 'asc' },
            },
        },
    })

    return NextResponse.json({
        groups: groups.map((group) => ({
            id: group.id,
            name: group.name,
            fixed: false,
            assignments: group.assignments.map((assignment) => ({
                id: assignment.id,
                connectionId: assignment.connectionId,
                modelId: assignment.modelId,
                failureCount: assignment.failureCount,
                ignoredUntil: assignment.ignoredUntil ? assignment.ignoredUntil.toISOString() : null,
                manuallyDisabled: assignment.manuallyDisabled,
            })),
            modelTypes: normalizeGroupModelTypes(safeParseJson(group.modelTypesJson)),
            settings: normalizeGroupSettings(safeParseJson(group.settingsJson)),
            failurePolicy: normalizeFailurePolicy(safeParseJson(group.failurePolicyJson)),
            pricingTiers: safeParseJson(group.pricingTiersJson, DEFAULT_PRICING_TIERS),
        })),
    })
}

export async function POST(request: NextRequest) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const name = String(body?.name || '').trim()
        if (!name) {
            return NextResponse.json({ detail: 'Missing name.' }, { status: 400 })
        }

        if (await hasDuplicateGroupName(user.userId, name)) {
            return NextResponse.json({ detail: 'Group name already exists.' }, { status: 409 })
        }

        const maxOrder = await prisma.aiModelGroup.aggregate({
            where: { ownerId: user.userId },
            _max: { sortOrder: true },
        })

        const sortOrder = (maxOrder._max.sortOrder ?? 0) + 1

        const group = await prisma.aiModelGroup.create({
            data: {
                ownerId: user.userId,
                name,
                sortOrder,
                settingsJson: JSON.stringify(DEFAULT_GROUP_SETTINGS),
                failurePolicyJson: JSON.stringify(DEFAULT_FAILURE_POLICY),
                pricingTiersJson: JSON.stringify(DEFAULT_PRICING_TIERS),
            },
        })

        return NextResponse.json({
            group: {
                id: group.id,
                name: group.name,
                fixed: false,
                assignments: [],
                modelTypes: null,
                settings: DEFAULT_GROUP_SETTINGS,
                failurePolicy: DEFAULT_FAILURE_POLICY,
                pricingTiers: DEFAULT_PRICING_TIERS,
            },
        })
    } catch (error) {
        console.error('Failed to create group:', error)
        const message = error instanceof Error ? error.message : 'Failed to create group.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to create group.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}
