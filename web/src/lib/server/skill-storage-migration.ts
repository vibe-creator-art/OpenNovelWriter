import fs from 'fs/promises'
import path from 'path'

import {
    getSkillsRoot,
    migrateLegacySkillDocument,
    parseSkillContent,
    parseSkillOnwMetadataText,
    sanitizeSkillDirectoryName,
    sanitizeOfficialSkillDocument,
} from '@/lib/server/skill-storage'

const OFFICIAL_FORMAT_MIGRATION_MARKER = '.official-skill-format-v1'
const PLACEHOLDER_ID_MIGRATION_MARKER = '.placeholder-skill-directory-ids-v1'
const LEGACY_PLACEHOLDER_ID = /^(?:新技能|new-skill)(?:-\d+)?$/iu
const DISABLED_SKILLS_FILE_NAME = '.disabled-skills.json'
const PRESET_ORIGINS_FILE_NAME = '.preset-origins.json'

async function writeAtomically(filePath: string, content: string) {
    const temporaryPath = `${filePath}.migration-${crypto.randomUUID()}`
    await fs.writeFile(temporaryPath, content, 'utf8')
    await fs.rename(temporaryPath, filePath)
}

/**
 * One-time filesystem migration from ONW-only SKILL.md frontmatter to the official folder shape:
 * SKILL.md keeps official metadata while category/prompt move to onw.json. Normal storage code has
 * no legacy parser; this runs before the server begins serving requests.
 */
export async function migrateSkillStorageToOfficialFormat() {
    const root = getSkillsRoot()
    await fs.mkdir(root, { recursive: true })

    const migrated = await migrateOfficialSkillDocuments(root)
    const renamed = await migratePlaceholderSkillDirectoryIds(root)
    return { migrated, renamed }
}

async function migrateOfficialSkillDocuments(root: string) {
    const markerPath = path.join(root, OFFICIAL_FORMAT_MIGRATION_MARKER)
    try {
        await fs.access(markerPath)
        return 0
    } catch {
        // Continue with the one-time migration.
    }

    let migrated = 0
    const owners = await fs.readdir(root, { withFileTypes: true })
    for (const owner of owners) {
        if (!owner.isDirectory()) continue
        const ownerRoot = path.join(root, owner.name)
        const entries = await fs.readdir(ownerRoot, { withFileTypes: true })
        for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const skillDirectory = path.join(ownerRoot, entry.name)
            const skillPath = path.join(skillDirectory, 'SKILL.md')
            const metadataPath = path.join(skillDirectory, 'onw.json')

            let content: string
            try {
                content = await fs.readFile(skillPath, 'utf8')
            } catch {
                continue
            }

            let metadataText: string | null = null
            try {
                metadataText = await fs.readFile(metadataPath, 'utf8')
                parseSkillOnwMetadataText(metadataText)
            } catch (error) {
                if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
            }

            const officialContent = sanitizeOfficialSkillDocument(content)
            if (metadataText === null) {
                const legacy = migrateLegacySkillDocument(content)
                metadataText = `${JSON.stringify(legacy.metadata, null, 2)}\n`
                await writeAtomically(metadataPath, metadataText)
            }
            if (officialContent !== content.replace(/\r\n/g, '\n')) {
                await writeAtomically(skillPath, officialContent)
            }
            migrated += 1
        }
    }

    await writeAtomically(markerPath, `${new Date().toISOString()}\n`)
    return migrated
}

async function migratePlaceholderSkillDirectoryIds(root: string) {
    const markerPath = path.join(root, PLACEHOLDER_ID_MIGRATION_MARKER)
    try {
        await fs.access(markerPath)
        return 0
    } catch {
        // Continue with the one-time migration.
    }

    let renamed = 0
    const owners = await fs.readdir(root, { withFileTypes: true })
    for (const owner of owners) {
        if (!owner.isDirectory()) continue
        const ownerRoot = path.join(root, owner.name)
        const entries = await fs.readdir(ownerRoot, { withFileTypes: true })
        const reservedIds = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
        const idChanges = new Map<string, string>()

        for (const entry of entries) {
            if (!entry.isDirectory() || !LEGACY_PLACEHOLDER_ID.test(entry.name)) continue

            let name: string
            try {
                const content = await fs.readFile(path.join(ownerRoot, entry.name, 'SKILL.md'), 'utf8')
                name = parseSkillContent(content).name
            } catch {
                continue
            }

            const baseId = sanitizeSkillDirectoryName(name)
            if (!baseId || baseId === entry.name) continue
            const nextId = getAvailableDirectoryId(baseId, reservedIds)
            await fs.rename(path.join(ownerRoot, entry.name), path.join(ownerRoot, nextId))
            reservedIds.delete(entry.name)
            reservedIds.add(nextId)
            idChanges.set(entry.name, nextId)
            renamed += 1
        }

        if (idChanges.size === 0) continue
        await Promise.all([
            remapDisabledSkillIds(ownerRoot, idChanges),
            remapPresetOriginIds(ownerRoot, idChanges),
            remapManagedCodexSkillLinks(root, owner.name, ownerRoot, idChanges),
        ])
    }

    await writeAtomically(markerPath, `${new Date().toISOString()}\n`)
    return renamed
}

function getAvailableDirectoryId(baseId: string, reservedIds: Set<string>) {
    let candidate = baseId
    let counter = 1
    while (reservedIds.has(candidate)) {
        counter += 1
        candidate = `${baseId}-${counter}`
    }
    return candidate
}

async function remapDisabledSkillIds(ownerRoot: string, idChanges: Map<string, string>) {
    const filePath = path.join(ownerRoot, DISABLED_SKILLS_FILE_NAME)
    let parsed: unknown
    try {
        parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
    }
    if (!Array.isArray(parsed)) return

    let changed = false
    const ids = parsed.map((value) => {
        if (typeof value !== 'string') return value
        const nextId = idChanges.get(value)
        if (!nextId) return value
        changed = true
        return nextId
    })
    if (changed) await writeAtomically(filePath, `${JSON.stringify(ids, null, 2)}\n`)
}

async function remapPresetOriginIds(ownerRoot: string, idChanges: Map<string, string>) {
    const filePath = path.join(ownerRoot, PRESET_ORIGINS_FILE_NAME)
    let parsed: unknown
    try {
        parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return

    const origins = parsed as Record<string, unknown>
    let changed = false
    for (const [oldId, nextId] of idChanges) {
        if (!Object.hasOwn(origins, oldId)) continue
        origins[nextId] = origins[oldId]
        delete origins[oldId]
        changed = true
    }
    if (changed) await writeAtomically(filePath, `${JSON.stringify(origins, null, 2)}\n`)
}

async function remapManagedCodexSkillLinks(
    skillsRoot: string,
    ownerId: string,
    ownerSkillsRoot: string,
    idChanges: Map<string, string>
) {
    const connectionsRoot = path.join(path.dirname(skillsRoot), 'codex', 'connections', ownerId)
    let connections: import('fs').Dirent[]
    try {
        connections = await fs.readdir(connectionsRoot, { withFileTypes: true })
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
    }

    await Promise.all(connections.filter((entry) => entry.isDirectory()).map(async (connection) => {
        const connectionSkillsRoot = path.join(connectionsRoot, connection.name, 'skills')
        for (const [oldId, nextId] of idChanges) {
            const oldLink = path.join(connectionSkillsRoot, oldId)
            let stats
            try {
                stats = await fs.lstat(oldLink)
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
                throw error
            }
            if (!stats.isSymbolicLink()) continue

            const target = await fs.readlink(oldLink)
            const expectedOldTarget = path.join(ownerSkillsRoot, oldId)
            if (path.resolve(connectionSkillsRoot, target) !== path.resolve(expectedOldTarget)) continue

            const nextLink = path.join(connectionSkillsRoot, nextId)
            const expectedNextTarget = path.join(ownerSkillsRoot, nextId)
            try {
                const nextStats = await fs.lstat(nextLink)
                if (!nextStats.isSymbolicLink()) {
                    throw new Error(`Cannot migrate skill link "${oldId}" because "${nextId}" already exists.`)
                }
                const existingTarget = await fs.readlink(nextLink)
                if (path.resolve(connectionSkillsRoot, existingTarget) !== path.resolve(expectedNextTarget)) {
                    throw new Error(`Cannot migrate skill link "${oldId}" because "${nextId}" points elsewhere.`)
                }
                await fs.unlink(oldLink)
                continue
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }

            const nextTarget = path.relative(connectionSkillsRoot, expectedNextTarget)
            await fs.symlink(nextTarget, nextLink, 'dir')
            await fs.unlink(oldLink)
        }
    }))
}
