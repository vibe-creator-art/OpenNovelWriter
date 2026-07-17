import fs from 'fs/promises'
import path from 'path'

import {
    createSkillFromDirectory,
    deleteSkill,
    getOwnedSkillDirectory,
    listSkills,
    readSkill,
    replaceSkillFromDirectory,
    setSkillEnabled,
    validateSkillDirectory,
} from '@/lib/server/skill-storage'

const CHANGE_SET_SCHEMA = 'open-novel-writer/skill-change-set'
const CHANGE_SET_VERSION = 1
const MAX_OPERATIONS = 100

type SkillChangeOperation =
    | { action: 'create'; directory: string; enabled?: boolean }
    | { action: 'update'; id: string; expectedUpdatedAt: string; directory: string; enabled?: boolean }
    | { action: 'delete'; id: string; expectedUpdatedAt: string }

export type SkillChangePlanItem = {
    action: 'create' | 'update' | 'delete'
    id: string | null
    name: string
    category: string | null
    fileCount: number | null
    enabled: boolean | null
}

type ParsedChangeSet = {
    operations: SkillChangeOperation[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requiredString(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`)
    return value.trim()
}

function normalizeRelativeDirectory(value: unknown, field: string) {
    const directory = requiredString(value, field).replace(/\\/g, '/')
    if (directory.startsWith('/') || directory.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error(`${field} must be a relative directory inside the change-set folder.`)
    }
    return directory
}

function parseSkillChangeSet(value: unknown): ParsedChangeSet {
    const root = asRecord(value)
    if (!root) throw new Error('Skill change-set must be an object.')
    if (root.schema !== CHANGE_SET_SCHEMA || root.version !== CHANGE_SET_VERSION) {
        throw new Error('Unsupported skill change-set format.')
    }
    if (!Array.isArray(root.operations) || root.operations.length === 0) {
        throw new Error('Skill change-set must contain at least one operation.')
    }
    if (root.operations.length > MAX_OPERATIONS) {
        throw new Error(`Skill change-set may contain at most ${MAX_OPERATIONS} operations.`)
    }

    const operations: SkillChangeOperation[] = root.operations.map((raw, index) => {
        const operation = asRecord(raw)
        if (!operation) throw new Error(`operations[${index}] must be an object.`)
        if (operation.enabled !== undefined && typeof operation.enabled !== 'boolean') {
            throw new Error(`operations[${index}].enabled must be a boolean when provided.`)
        }
        const action = operation.action
        if (action === 'create') {
            return {
                action,
                directory: normalizeRelativeDirectory(operation.directory, `operations[${index}].directory`),
                ...(typeof operation.enabled === 'boolean' ? { enabled: operation.enabled } : {}),
            }
        }
        if (action === 'update') {
            return {
                action,
                id: requiredString(operation.id, `operations[${index}].id`),
                expectedUpdatedAt: requiredString(operation.expectedUpdatedAt, `operations[${index}].expectedUpdatedAt`),
                directory: normalizeRelativeDirectory(operation.directory, `operations[${index}].directory`),
                ...(typeof operation.enabled === 'boolean' ? { enabled: operation.enabled } : {}),
            }
        }
        if (action === 'delete') {
            return {
                action,
                id: requiredString(operation.id, `operations[${index}].id`),
                expectedUpdatedAt: requiredString(operation.expectedUpdatedAt, `operations[${index}].expectedUpdatedAt`),
            }
        }
        throw new Error(`operations[${index}].action must be create, update, or delete.`)
    })

    const existingIds = new Set<string>()
    const directories = new Set<string>()
    for (const operation of operations) {
        if (operation.action !== 'create') {
            if (existingIds.has(operation.id)) throw new Error(`Skill ${operation.id} has more than one operation.`)
            existingIds.add(operation.id)
        }
        if (operation.action !== 'delete') {
            if (directories.has(operation.directory)) throw new Error(`Directory ${operation.directory} is used more than once.`)
            directories.add(operation.directory)
        }
    }
    return { operations }
}

async function resolveSourceDirectory(sourceRoot: string, relativeDirectory: string) {
    const [realRoot, realDirectory] = await Promise.all([
        fs.realpath(sourceRoot),
        fs.realpath(path.resolve(sourceRoot, ...relativeDirectory.split('/'))),
    ])
    const relative = path.relative(realRoot, realDirectory)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Skill directory ${relativeDirectory} is outside the change-set folder.`)
    }
    return realDirectory
}

async function countFiles(directory: string) {
    let count = 0
    const visit = async (current: string) => {
        for (const entry of await fs.readdir(current, { withFileTypes: true })) {
            if (entry.isDirectory()) await visit(path.join(current, entry.name))
            else if (entry.isFile()) count += 1
        }
    }
    await visit(directory)
    return count
}

export async function exportSkillLibrary(ownerId: string) {
    const skills = await listSkills(ownerId)
    return {
        manifest: {
            schema: 'open-novel-writer/skill-library-snapshot',
            version: 1,
            exportedAt: new Date().toISOString(),
            skillCount: skills.length,
            skills: skills.map((skill) => ({
                id: skill.id,
                name: skill.name,
                description: skill.description,
                category: skill.category,
                prompt: skill.prompt,
                enabled: skill.enabled,
                updatedAt: skill.updatedAt.toISOString(),
                sourcePresetId: skill.sourcePresetId,
                sourcePresetRevision: skill.sourcePresetRevision,
                directory: `skills/${skill.id}`,
            })),
        },
        skills: skills.map((skill) => ({
            id: skill.id,
            sourceDirectory: getOwnedSkillDirectory(ownerId, skill.id),
        })),
    }
}

export async function validateSkillChanges(params: {
    ownerId: string
    changeSet: unknown
    sourceRoot: string
}) {
    const parsed = parseSkillChangeSet(params.changeSet)
    const existing = await listSkills(params.ownerId)
    const existingById = new Map(existing.map((skill) => [skill.id, skill]))
    const finalNames = new Map(existing.map((skill) => [skill.id, skill.name.trim().toLowerCase()]))
    const resolvedDirectories = new Map<SkillChangeOperation, string>()
    const plan: SkillChangePlanItem[] = []

    for (const operation of parsed.operations) {
        if (operation.action === 'create') continue
        const skill = existingById.get(operation.id)
        if (!skill) throw new Error(`Skill ${operation.id} was not found.`)
        if (skill.updatedAt.toISOString() !== operation.expectedUpdatedAt) {
            throw new Error(`Skill "${skill.name}" changed after export. Export the library again before applying changes.`)
        }
        if (operation.action === 'delete') finalNames.delete(operation.id)
        if (operation.action === 'update' && skill.sourcePresetId) {
            throw new Error(`Skill "${skill.name}" comes from an official preset. Clone it before editing.`)
        }
    }

    let createIndex = 0
    for (const operation of parsed.operations) {
        if (operation.action === 'delete') {
            const skill = existingById.get(operation.id)!
            plan.push({ action: 'delete', id: skill.id, name: skill.name, category: skill.category, fileCount: null, enabled: null })
            continue
        }

        const directory = await resolveSourceDirectory(params.sourceRoot, operation.directory)
        const metadata = await validateSkillDirectory(directory)
        resolvedDirectories.set(operation, directory)
        const key = operation.action === 'update' ? operation.id : `create:${createIndex++}`
        finalNames.set(key, metadata.name.trim().toLowerCase())
        plan.push({
            action: operation.action,
            id: operation.action === 'update' ? operation.id : null,
            name: metadata.name,
            category: metadata.category,
            fileCount: await countFiles(directory),
            enabled: operation.enabled ?? (operation.action === 'update' ? existingById.get(operation.id)?.enabled ?? true : true),
        })
    }

    const nameOwners = new Map<string, string>()
    for (const [id, name] of finalNames) {
        const previous = nameOwners.get(name)
        if (previous) throw new Error(`Skill name "${name}" would be duplicated by ${previous} and ${id}.`)
        nameOwners.set(name, id)
    }

    return { parsed, plan, resolvedDirectories }
}

export async function applySkillChanges(params: {
    ownerId: string
    changeSet: unknown
    sourceRoot: string
}) {
    const validation = await validateSkillChanges(params)
    const results: Array<{ action: string; id: string; name: string }> = []

    for (const operation of validation.parsed.operations) {
        if (operation.action === 'delete') {
            const skill = await readSkill(params.ownerId, operation.id)
            await deleteSkill(params.ownerId, operation.id)
            results.push({ action: 'delete', id: operation.id, name: skill.name })
            continue
        }

        const sourceDirectory = validation.resolvedDirectories.get(operation)!
        let skill = operation.action === 'create'
            ? await createSkillFromDirectory({ ownerId: params.ownerId, sourceDirectory })
            : await replaceSkillFromDirectory({ ownerId: params.ownerId, skillId: operation.id, sourceDirectory })
        if (typeof operation.enabled === 'boolean' && operation.enabled !== skill.enabled) {
            skill = await setSkillEnabled(params.ownerId, skill.id, operation.enabled)
        }
        results.push({ action: operation.action, id: skill.id, name: skill.name })
    }

    return { plan: validation.plan, results }
}
