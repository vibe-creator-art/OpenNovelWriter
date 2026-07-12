import fs from 'fs/promises'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth'
import { getPrismaClient } from '@/lib/db'
import { getCodexSessionWorkspacePath } from '@/lib/server/codex-session-workspace'

interface RouteContext {
    params: Promise<unknown>
}

const prisma = getPrismaClient({ ensureModel: 'codexSession' })
const MAX_JSON_BYTES = 5 * 1024 * 1024

async function getRouteId(params: Promise<unknown>) {
    const resolved = await params
    return typeof resolved === 'object' && resolved !== null && typeof (resolved as { id?: unknown }).id === 'string'
        ? (resolved as { id: string }).id
        : ''
}

function sanitizeJsonFileName(name: string) {
    const base = path.basename(name, path.extname(name))
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}._-]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
    return `${base || 'prompt-preset'}.json`
}

async function findAvailablePath(directory: string, requestedName: string) {
    const stem = path.basename(requestedName, '.json')
    for (let suffix = 1; suffix <= 1000; suffix += 1) {
        const fileName = suffix === 1 ? requestedName : `${stem}-${suffix}.json`
        const filePath = path.join(directory, fileName)
        try {
            await fs.access(filePath)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { fileName, filePath }
            throw error
        }
    }
    throw new Error('Could not allocate an artifact file name.')
}

export async function POST(request: NextRequest, { params }: RouteContext) {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })

    const id = await getRouteId(params)
    const session = await prisma.codexSession.findFirst({
        where: { id, ownerId: user.userId },
        select: { id: true },
    })
    if (!session) return NextResponse.json({ detail: 'Codex session not found' }, { status: 404 })

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
        return NextResponse.json({ detail: 'A JSON file is required.' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > MAX_JSON_BYTES) {
        return NextResponse.json({ detail: 'JSON files must be between 1 byte and 5 MB.' }, { status: 400 })
    }
    if (path.extname(file.name).toLowerCase() !== '.json') {
        return NextResponse.json({ detail: 'Only .json files can be attached as artifacts.' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const text = bytes.toString('utf8')
    if (Buffer.from(text, 'utf8').compare(bytes) !== 0) {
        return NextResponse.json({ detail: 'The JSON file must use UTF-8 encoding.' }, { status: 400 })
    }
    try {
        JSON.parse(text)
    } catch {
        return NextResponse.json({ detail: 'The attached file is not valid JSON.' }, { status: 400 })
    }

    const artifactsPath = path.join(getCodexSessionWorkspacePath(user.userId, session.id), 'artifacts')
    await fs.mkdir(artifactsPath, { recursive: true })
    const target = await findAvailablePath(artifactsPath, sanitizeJsonFileName(file.name))
    await fs.writeFile(target.filePath, bytes, { flag: 'wx' })

    return NextResponse.json({
        artifact: {
            fileName: target.fileName,
            originalName: file.name,
            size: file.size,
        },
    })
}
