#!/usr/bin/env bash

# Temporary cleanup utility for users upgrading from the pre-2026-07-11
# custom Codex connection format. Those rows kept auth/config in connection
# folders and therefore have no structured upstreamFormat in the database.
#
# TODO(remove after 2026-09-13): delete this script once users have had roughly
# two months to complete the one-time cleanup. Do not turn this into a permanent
# runtime compatibility path.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$SCRIPT_DIR/web"

usage() {
    echo "Usage: ./clean_old_codex_connection.sh [--dry-run] [--yes]"
    echo
    echo "  --dry-run  List legacy connections without deleting anything."
    echo "  --yes      Skip the interactive confirmation."
}

for argument in "$@"; do
    case "$argument" in
        --dry-run|--yes)
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $argument" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [[ ! -d "$WEB_DIR/node_modules/@prisma/client" ]]; then
    echo "Missing web dependencies. Run npm install in $WEB_DIR first." >&2
    exit 1
fi

cd "$WEB_DIR"
node - "$@" <<'NODE'
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const readline = require('readline/promises')

require('dotenv').config({ path: path.join(process.cwd(), '.env'), quiet: true })
const { PrismaClient } = require('@prisma/client')

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const assumeYes = args.has('--yes')
const prisma = new PrismaClient()

function getDataDir() {
    const override = process.env.OPENNOVELWRITER_DATA_DIR?.trim()
    if (override) return path.resolve(override)

    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'OpenNovelWriter')
    }

    const base = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), '.local', 'share')
    return path.join(base, 'opennovelwriter')
}

function getDatabasePath() {
    const databaseUrl = process.env.DATABASE_URL?.trim()
    if (!databaseUrl?.startsWith('file:')) {
        throw new Error('DATABASE_URL must be a SQLite file: URL.')
    }

    const value = decodeURIComponent(databaseUrl.slice('file:'.length).split('?')[0])
    if (!value) throw new Error('DATABASE_URL does not contain a database path.')

    return path.isAbsolute(value)
        ? value
        : path.resolve(process.cwd(), 'prisma', value)
}

function timestamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

async function confirmDeletion() {
    if (assumeYes) return true
    if (!process.stdin.isTTY) {
        throw new Error('Interactive confirmation requires a TTY. Re-run with --yes to confirm deletion.')
    }

    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
        const answer = await prompt.question('Delete these legacy connections and folders? Type DELETE to continue: ')
        return answer.trim() === 'DELETE'
    } finally {
        prompt.close()
    }
}

async function main() {
    const databasePath = getDatabasePath()
    const backupDir = path.join(process.cwd(), 'backup')
    const connectionsRoot = path.join(getDataDir(), 'codex', 'connections')
    const legacyConnections = await prisma.$queryRawUnsafe(`
        SELECT id, ownerId, name
        FROM CodexConnection
        WHERE providerType = 'custom'
          AND (upstreamFormat IS NULL OR trim(upstreamFormat) = '')
        ORDER BY ownerId, createdAt
    `)

    if (legacyConnections.length === 0) {
        console.log('No legacy custom Codex connections found.')
        return
    }

    console.log(`Database: ${databasePath}`)
    console.log(`Backup directory: ${backupDir}`)
    console.log(`Connection folders: ${connectionsRoot}`)
    console.log(`Found ${legacyConnections.length} legacy custom Codex connection(s):`)
    for (const connection of legacyConnections) {
        console.log(`- ${connection.name} (${connection.ownerId}/${connection.id})`)
    }

    if (dryRun) {
        console.log('Dry run complete. Nothing was deleted.')
        return
    }

    console.log('Warning: database rows and connection folders will be permanently deleted.')
    console.log('The database will be backed up, but the deleted folder contents will not.')
    if (!(await confirmDeletion())) {
        console.log('Cleanup cancelled. Nothing was deleted.')
        return
    }

    await fs.access(databasePath)
    await fs.mkdir(backupDir, { recursive: true, mode: 0o700 })
    await fs.chmod(backupDir, 0o700)
    const backupPath = path.join(
        backupDir,
        `${path.basename(databasePath)}.pre-codex-cleanup-${timestamp()}.bak`
    )
    const escapedBackupPath = backupPath.replaceAll("'", "''")
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escapedBackupPath}'`)
    await fs.chmod(backupPath, 0o600)
    console.log(`Database backup created: ${backupPath}`)

    const connectionIds = legacyConnections.map((connection) => connection.id)
    await prisma.$transaction([
        prisma.codexSession.updateMany({
            where: { codexConnectionId: { in: connectionIds } },
            data: { codexConnectionId: null },
        }),
        prisma.codexConnection.deleteMany({
            where: { id: { in: connectionIds } },
        }),
    ])

    const folderFailures = []
    for (const connection of legacyConnections) {
        const folder = path.join(connectionsRoot, connection.ownerId, connection.id)
        try {
            await fs.rm(folder, { recursive: true, force: true })
            console.log(`Deleted folder: ${folder}`)
        } catch (error) {
            folderFailures.push({ folder, error })
        }
    }

    console.log(`Deleted ${legacyConnections.length} legacy database record(s).`)
    if (folderFailures.length > 0) {
        for (const failure of folderFailures) {
            console.error(`Failed to delete folder ${failure.folder}: ${failure.error.message}`)
        }
        process.exitCode = 1
    }
}

main()
    .catch((error) => {
        console.error(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
NODE
