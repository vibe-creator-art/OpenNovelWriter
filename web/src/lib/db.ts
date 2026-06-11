import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined
}

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    })

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
        const resolved = req.resolve('@prisma/client')
        delete req.cache[resolved]
        const { PrismaClient: FreshPrismaClient } = req('@prisma/client') as typeof import('@prisma/client')
        const fresh = new FreshPrismaClient({
            log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        })
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
