import fs from 'fs/promises'
import path from 'path'

import { BUILT_IN_PETS, isBuiltInPetId, type PetManifest, type PetSummary } from '@/lib/pets'
import { getOpenNovelWriterDataDir } from '@/lib/server/data-dir'

const MANIFEST_FILE_NAME = 'pet.json'
const MAX_SPRITESHEET_BYTES = 20 * 1024 * 1024
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export class PetNotFoundError extends Error {}
export class DuplicatePetError extends Error {}
export class BuiltInPetError extends Error {}
export class InvalidPetPackageError extends Error {}

export function getPetsRoot() {
    return path.join(getOpenNovelWriterDataDir(), 'pets')
}

export function getUserPetsRoot(ownerId: string) {
    return path.join(getPetsRoot(), ownerId)
}

export async function listPets(ownerId: string): Promise<PetSummary[]> {
    const root = getUserPetsRoot(ownerId)
    await fs.mkdir(root, { recursive: true })
    const entries = await fs.readdir(root, { withFileTypes: true })
    const installed = await Promise.all(entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(async (entry) => {
            try {
                return await readInstalledPet(ownerId, entry.name)
            } catch {
                return null
            }
        }))

    return [
        ...BUILT_IN_PETS,
        ...installed
            .filter((pet): pet is PetSummary => pet !== null)
            .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    ]
}

export async function petExists(ownerId: string, petId: string) {
    if (isBuiltInPetId(petId)) return true
    try {
        await readInstalledPet(ownerId, petId)
        return true
    } catch {
        return false
    }
}

export async function installPetFromDirectory(ownerId: string, sourceDirectory: string) {
    const manifest = await readPackageManifest(sourceDirectory)
    if (isBuiltInPetId(manifest.id)) {
        throw new BuiltInPetError('Built-in pets cannot be replaced.')
    }

    const sourceSpritesheet = path.join(sourceDirectory, manifest.spritesheetPath)
    const spritesheet = await fs.readFile(sourceSpritesheet).catch(() => null)
    if (!spritesheet) throw new InvalidPetPackageError(`Missing ${manifest.spritesheetPath}.`)
    if (spritesheet.byteLength > MAX_SPRITESHEET_BYTES) {
        throw new InvalidPetPackageError('Pet spritesheets cannot exceed 20 MiB.')
    }
    const dimensions = readImageDimensions(spritesheet)
    if (!dimensions || dimensions.width !== 1536 || dimensions.height !== 1872) {
        throw new InvalidPetPackageError('Pet spritesheet must be exactly 1536×1872 pixels.')
    }

    const root = getUserPetsRoot(ownerId)
    await fs.mkdir(root, { recursive: true })
    const destination = path.join(root, manifest.id)
    if (await pathExists(destination)) throw new DuplicatePetError(`Pet ${manifest.id} is already installed.`)

    const temporary = await fs.mkdtemp(path.join(root, '.install-'))
    try {
        await Promise.all([
            fs.writeFile(path.join(temporary, MANIFEST_FILE_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
            fs.writeFile(path.join(temporary, manifest.spritesheetPath), spritesheet),
        ])
        await fs.rename(temporary, destination)
    } catch (error) {
        await fs.rm(temporary, { recursive: true, force: true })
        throw error
    }

    return toPetSummary(manifest)
}

export async function deletePet(ownerId: string, petId: string) {
    if (isBuiltInPetId(petId)) throw new BuiltInPetError('Built-in pets cannot be deleted.')
    assertPetId(petId)
    const directory = path.join(getUserPetsRoot(ownerId), petId)
    if (!(await pathExists(directory))) throw new PetNotFoundError(`Pet ${petId} was not found.`)
    await fs.rm(directory, { recursive: true, force: true })
}

export async function readPetSpritesheet(ownerId: string, petId: string) {
    const pet = await readInstalledPet(ownerId, petId)
    const filePath = path.join(getUserPetsRoot(ownerId), pet.id, pet.spritesheetPath)
    return {
        bytes: await fs.readFile(filePath),
        contentType: path.extname(pet.spritesheetPath).toLowerCase() === '.png' ? 'image/png' : 'image/webp',
    }
}

async function readInstalledPet(ownerId: string, petId: string) {
    assertPetId(petId)
    const directory = path.join(getUserPetsRoot(ownerId), petId)
    const manifest = await readPackageManifest(directory)
    if (manifest.id !== petId) throw new InvalidPetPackageError('Pet folder and manifest id do not match.')
    await fs.access(path.join(directory, manifest.spritesheetPath))
    return toPetSummary(manifest)
}

async function readPackageManifest(directory: string): Promise<PetManifest> {
    const text = await fs.readFile(path.join(directory, MANIFEST_FILE_NAME), 'utf8').catch(() => null)
    if (!text) throw new InvalidPetPackageError('Missing pet.json.')
    let value: unknown
    try {
        value = JSON.parse(text)
    } catch {
        throw new InvalidPetPackageError('pet.json is not valid JSON.')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new InvalidPetPackageError('pet.json must be an object.')
    }
    const record = value as Record<string, unknown>
    const id = requireText(record.id, 'id', 64)
    assertPetId(id)
    const displayName = requireText(record.displayName, 'displayName', 80)
    const description = requireText(record.description, 'description', 300)
    const spritesheetPath = requireText(record.spritesheetPath, 'spritesheetPath', 100)
    if (path.basename(spritesheetPath) !== spritesheetPath || !/\.(png|webp)$/i.test(spritesheetPath)) {
        throw new InvalidPetPackageError('spritesheetPath must name a PNG or WebP file in the package root.')
    }
    return { id, displayName, description, spritesheetPath }
}

function toPetSummary(manifest: PetManifest): PetSummary {
    return {
        ...manifest,
        builtIn: false,
        spriteUrl: `/api/pets/${encodeURIComponent(manifest.id)}/spritesheet`,
    }
}

function requireText(value: unknown, name: string, maxLength: number) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
        throw new InvalidPetPackageError(`${name} must be a non-empty string no longer than ${maxLength} characters.`)
    }
    return value.trim()
}

function assertPetId(petId: string) {
    if (!PET_ID_PATTERN.test(petId)) {
        throw new InvalidPetPackageError('Pet id must use lowercase letters, digits, and hyphens.')
    }
}

async function pathExists(filePath: string) {
    try {
        await fs.access(filePath)
        return true
    } catch {
        return false
    }
}

function readImageDimensions(bytes: Buffer): { width: number; height: number } | null {
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    }
    if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
        return null
    }
    const chunk = bytes.toString('ascii', 12, 16)
    if (chunk === 'VP8X') {
        return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 }
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
        const bits = bytes.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    return null
}

function readUInt24LE(bytes: Buffer, offset: number) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}
