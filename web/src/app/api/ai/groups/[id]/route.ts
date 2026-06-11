import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
    normalizeFailurePolicy,
    normalizeGroupModelTypes,
    normalizeGroupSettings,
} from '@/lib/ai-group-config'

const normalizeName = (value: string) => value.trim().toLocaleLowerCase()

async function hasDuplicateGroupName(ownerId: string, name: string, excludeId: string) {
    const groups = await prisma.aiModelGroup.findMany({
        where: {
            ownerId,
            id: { not: excludeId },
        },
        select: { name: true },
    })

    const normalizedName = normalizeName(name)
    return groups.some((group) => normalizeName(group.name) === normalizedName)
}

function safeStringify(value: unknown) {
    try {
        return JSON.stringify(value ?? {})
    } catch {
        return JSON.stringify({})
    }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await context.params

    try {
        const body = await request.json()
        const hasNameField = typeof body?.name === 'string'
        const hasModelTypesField = Object.prototype.hasOwnProperty.call(body ?? {}, 'modelTypes')
        const normalizedModelTypes =
            hasModelTypesField && body?.modelTypes !== null
                ? normalizeGroupModelTypes(body.modelTypes)
                : null
        const name = hasNameField ? body.name.trim() : undefined
        if (hasNameField && !name) {
            return NextResponse.json({ detail: 'Missing name.' }, { status: 400 })
        }

        const group = await prisma.aiModelGroup.findFirst({
            where: { id, ownerId: user.userId },
        })

        if (!group) {
            return NextResponse.json({ detail: 'Not found' }, { status: 404 })
        }

        if (name && (await hasDuplicateGroupName(user.userId, name, id))) {
            return NextResponse.json({ detail: 'Group name already exists.' }, { status: 409 })
        }

        const updated = await prisma.aiModelGroup.update({
            where: { id },
            data: {
                ...(name ? { name } : {}),
                ...(body?.settings ? { settingsJson: safeStringify(normalizeGroupSettings(body.settings)) } : {}),
                ...(hasModelTypesField
                    ? {
                        modelTypesJson: normalizedModelTypes ? safeStringify(normalizedModelTypes) : null,
                    }
                    : {}),
                ...(body?.failurePolicy
                    ? { failurePolicyJson: safeStringify(normalizeFailurePolicy(body.failurePolicy)) }
                    : {}),
                ...(body?.pricingTiers ? { pricingTiersJson: safeStringify(body.pricingTiers) } : {}),
            },
        })

        return NextResponse.json({ id: updated.id })
    } catch (error) {
        console.error('Failed to update group:', error)
        const message = error instanceof Error ? error.message : 'Failed to update group.'
        const detail = process.env.NODE_ENV === 'production' ? 'Failed to update group.' : message
        return NextResponse.json({ detail }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request)
    if (!user) {
        return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await context.params

    const group = await prisma.aiModelGroup.findFirst({
        where: { id, ownerId: user.userId },
        select: { id: true },
    })

    if (!group) {
        return NextResponse.json({ detail: 'Not found' }, { status: 404 })
    }

    await prisma.aiModelGroup.delete({ where: { id } })
    return NextResponse.json({ message: 'Deleted' })
}
