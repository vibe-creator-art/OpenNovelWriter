import path from 'node:path'

import { PrismaClient } from '@/generated/prisma/client'
import { createPrismaSqliteAdapter } from '@/lib/server/prisma-sqlite.cjs'

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined
}

function createPrismaClient(ClientConstructor: typeof PrismaClient = PrismaClient) {
    return new ClientConstructor({
        adapter: createPrismaSqliteAdapter(process.env.DATABASE_URL, process.cwd()),
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export function getPrismaClient(options?: { ensureModel?: string }) {
    const client = globalForPrisma.prisma ?? prisma
    const ensureModel = options?.ensureModel

    if (!ensureModel || (client as unknown as Record<string, unknown>)[ensureModel]) {
        return client
    }

    if (process.env.NODE_ENV !== 'development') {
        throw new Error(`Prisma client is missing model "${ensureModel}". Restart the server.`)
    }

    try {
        const req = eval('require') as NodeRequire
        const resolved = req.resolve(path.join(process.cwd(), 'generated', 'prisma', 'client.js'))
        delete req.cache[resolved]
        const { PrismaClient: FreshPrismaClient } = req(resolved) as typeof import('@/generated/prisma/client')
        const fresh = createPrismaClient(FreshPrismaClient)
        globalForPrisma.prisma = fresh

        if (!(fresh as unknown as Record<string, unknown>)[ensureModel]) {
            throw new Error(`Prisma client is missing model "${ensureModel}". Restart the dev server.`)
        }

        return fresh
    } catch (error) {
        if (error instanceof Error) throw error
        throw new Error(`Prisma client is missing model "${ensureModel}". Restart the dev server.`)
    }
}
