/* eslint-disable @typescript-eslint/no-require-imports */

const path = require('node:path')

const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3')

function resolvePrismaSqliteUrl(databaseUrl, projectRoot) {
    const url = String(databaseUrl ?? '').trim()
    if (!url) throw new Error('DATABASE_URL is required.')
    if (url === ':memory:') return url
    if (!url.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file: URL.')

    const databasePath = url.slice('file:'.length)
    if (!databasePath) throw new Error('DATABASE_URL does not contain a database path.')

    const resolvedPath = path.isAbsolute(databasePath) || path.win32.isAbsolute(databasePath)
        ? databasePath
        : path.resolve(projectRoot, 'prisma', databasePath)
    return `file:${resolvedPath.replace(/\\/g, '/')}`
}

function createPrismaSqliteAdapter(databaseUrl, projectRoot) {
    return new PrismaBetterSqlite3(
        { url: resolvePrismaSqliteUrl(databaseUrl, projectRoot) },
        { timestampFormat: 'unixepoch-ms' },
    )
}

module.exports = { createPrismaSqliteAdapter, resolvePrismaSqliteUrl }
