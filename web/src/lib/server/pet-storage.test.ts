import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
    BuiltInPetError,
    deletePet,
    DuplicatePetError,
    installPetFromDirectory,
    InvalidPetPackageError,
    listPets,
} from './pet-storage'

test('installs, lists, and deletes a Codex community pet', async () => {
    const previousDataDir = process.env.OPENNOVELWRITER_DATA_DIR
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-pet-storage-'))
    process.env.OPENNOVELWRITER_DATA_DIR = path.join(root, 'data')
    try {
        const packageDirectory = path.join(root, 'package')
        await fs.mkdir(packageDirectory)
        await Promise.all([
            fs.writeFile(path.join(packageDirectory, 'pet.json'), JSON.stringify({
                id: 'community-pet',
                displayName: 'Community Pet',
                description: 'A community pet.',
                spritesheetPath: 'spritesheet.webp',
                kind: 'person',
            })),
            fs.writeFile(path.join(packageDirectory, 'spritesheet.webp'), createVp8xWebpHeader(1536, 1872)),
        ])

        const installed = await installPetFromDirectory('owner-1', packageDirectory)
        assert.equal(installed.id, 'community-pet')
        assert.equal(installed.builtIn, false)
        assert.deepEqual((await listPets('owner-1')).map((pet) => pet.id), ['xixi', 'luoluo', 'community-pet'])
        await assert.rejects(
            installPetFromDirectory('owner-1', packageDirectory),
            (error: unknown) => error instanceof DuplicatePetError
        )

        await deletePet('owner-1', 'community-pet')
        assert.deepEqual((await listPets('owner-1')).map((pet) => pet.id), ['xixi', 'luoluo'])
        await assert.rejects(
            deletePet('owner-1', 'xixi'),
            (error: unknown) => error instanceof BuiltInPetError
        )
        await assert.rejects(
            deletePet('owner-1', 'luoluo'),
            (error: unknown) => error instanceof BuiltInPetError
        )
    } finally {
        if (previousDataDir === undefined) delete process.env.OPENNOVELWRITER_DATA_DIR
        else process.env.OPENNOVELWRITER_DATA_DIR = previousDataDir
        await fs.rm(root, { recursive: true, force: true })
    }
})

test('rejects a spritesheet with the wrong dimensions', async () => {
    const previousDataDir = process.env.OPENNOVELWRITER_DATA_DIR
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-pet-storage-'))
    process.env.OPENNOVELWRITER_DATA_DIR = path.join(root, 'data')
    try {
        const packageDirectory = path.join(root, 'package')
        await fs.mkdir(packageDirectory)
        await Promise.all([
            fs.writeFile(path.join(packageDirectory, 'pet.json'), JSON.stringify({
                id: 'bad-size',
                displayName: 'Bad Size',
                description: 'Invalid dimensions.',
                spritesheetPath: 'spritesheet.webp',
            })),
            fs.writeFile(path.join(packageDirectory, 'spritesheet.webp'), createVp8xWebpHeader(512, 512)),
        ])
        await assert.rejects(
            installPetFromDirectory('owner-1', packageDirectory),
            (error: unknown) => error instanceof InvalidPetPackageError
        )
    } finally {
        if (previousDataDir === undefined) delete process.env.OPENNOVELWRITER_DATA_DIR
        else process.env.OPENNOVELWRITER_DATA_DIR = previousDataDir
        await fs.rm(root, { recursive: true, force: true })
    }
})

function createVp8xWebpHeader(width: number, height: number) {
    const bytes = Buffer.alloc(30)
    bytes.write('RIFF', 0, 'ascii')
    bytes.writeUInt32LE(22, 4)
    bytes.write('WEBP', 8, 'ascii')
    bytes.write('VP8X', 12, 'ascii')
    bytes.writeUInt32LE(10, 16)
    writeUInt24LE(bytes, 24, width - 1)
    writeUInt24LE(bytes, 27, height - 1)
    return bytes
}

function writeUInt24LE(bytes: Buffer, offset: number, value: number) {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >>> 8) & 0xff
    bytes[offset + 2] = (value >>> 16) & 0xff
}
