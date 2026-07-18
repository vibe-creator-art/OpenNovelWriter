import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createAtomicFileWriter, type AtomicFileSystem } from './atomic-file-write'

function fileError(code: string) {
    return Object.assign(new Error(code), { code })
}

function createFakeFileSystem(initialFiles: Record<string, string> = {}) {
    const files = new Map(Object.entries(initialFiles))
    const events: string[] = []
    let remainingRenameFailures = 0
    let renameFailureCode = 'EPERM'
    let activeRenames = 0
    let maxActiveRenames = 0

    const fileSystem: AtomicFileSystem = {
        async readFile(filePath) {
            events.push(`read:${filePath}`)
            const content = files.get(filePath)
            if (content === undefined) throw fileError('ENOENT')
            return content
        },
        async writeFile(filePath, content) {
            events.push(`write:${filePath}`)
            if (files.has(filePath)) throw fileError('EEXIST')
            files.set(filePath, content)
        },
        async rename(sourcePath, destinationPath) {
            events.push(`rename:${sourcePath}->${destinationPath}`)
            activeRenames += 1
            maxActiveRenames = Math.max(maxActiveRenames, activeRenames)
            await Promise.resolve()
            try {
                if (remainingRenameFailures > 0) {
                    remainingRenameFailures -= 1
                    throw fileError(renameFailureCode)
                }
                const content = files.get(sourcePath)
                if (content === undefined) throw fileError('ENOENT')
                files.delete(sourcePath)
                files.set(destinationPath, content)
            } finally {
                activeRenames -= 1
            }
        },
        async rm(filePath) {
            events.push(`rm:${filePath}`)
            files.delete(filePath)
        },
    }

    return {
        files,
        events,
        fileSystem,
        get maxActiveRenames() {
            return maxActiveRenames
        },
        failNextRenames(count: number, code = 'EPERM') {
            remainingRenameFailures = count
            renameFailureCode = code
        },
    }
}

describe('createAtomicFileWriter', () => {
    test('does not replace a file whose content is unchanged', async () => {
        const fake = createFakeFileSystem({ '/config.toml': 'same' })
        const write = createAtomicFileWriter({
            fileSystem: fake.fileSystem,
            createTemporaryPath: () => '/config.toml.tmp',
        })

        await write('/config.toml', 'same')

        assert.deepEqual(fake.events, ['read:/config.toml'])
        assert.equal(fake.files.get('/config.toml'), 'same')
    })

    test('retries transient Windows rename failures and removes the temporary file', async () => {
        const fake = createFakeFileSystem({ '/config.toml': 'old' })
        const delays: number[] = []
        fake.failNextRenames(2)
        const write = createAtomicFileWriter({
            fileSystem: fake.fileSystem,
            retryDelaysMs: [25, 50, 100],
            createTemporaryPath: () => '/config.toml.tmp',
            sleep: async (milliseconds) => {
                delays.push(milliseconds)
            },
        })

        await write('/config.toml', 'new')

        assert.equal(fake.files.get('/config.toml'), 'new')
        assert.equal(fake.files.has('/config.toml.tmp'), false)
        assert.deepEqual(delays, [25, 50])
        assert.equal(fake.events.filter((event) => event.startsWith('rename:')).length, 3)
    })

    test('serializes concurrent writes to the same path', async () => {
        const fake = createFakeFileSystem({ '/config.toml': 'old' })
        let temporaryIndex = 0
        const write = createAtomicFileWriter({
            fileSystem: fake.fileSystem,
            createTemporaryPath: () => `/config.toml.${temporaryIndex += 1}.tmp`,
        })

        await Promise.all([
            write('/config.toml', 'first'),
            write('/config.toml', 'second'),
        ])

        assert.equal(fake.files.get('/config.toml'), 'second')
        assert.equal(fake.maxActiveRenames, 1)
        assert.equal(fake.events.filter((event) => event.startsWith('rename:')).length, 2)
    })

    test('keeps the existing file and cleans up when retries are exhausted', async () => {
        const fake = createFakeFileSystem({ '/config.toml': 'old' })
        fake.failNextRenames(3)
        const write = createAtomicFileWriter({
            fileSystem: fake.fileSystem,
            retryDelaysMs: [0, 0],
            createTemporaryPath: () => '/config.toml.tmp',
            sleep: async () => {},
        })

        await assert.rejects(write('/config.toml', 'new'), (error: unknown) => (
            (error as NodeJS.ErrnoException).code === 'EPERM'
        ))

        assert.equal(fake.files.get('/config.toml'), 'old')
        assert.equal(fake.files.has('/config.toml.tmp'), false)
    })
})
