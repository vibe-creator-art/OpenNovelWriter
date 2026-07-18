import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const
const RETRIABLE_RENAME_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])

export type AtomicFileSystem = {
    readFile(filePath: string, encoding: 'utf8'): Promise<string>
    writeFile(
        filePath: string,
        content: string,
        options: { encoding: 'utf8'; mode: number; flag: 'wx' }
    ): Promise<void>
    rename(sourcePath: string, destinationPath: string): Promise<void>
    rm(filePath: string, options: { force: true }): Promise<void>
}

type AtomicFileWriterFactoryOptions = {
    fileSystem?: AtomicFileSystem
    retryDelaysMs?: readonly number[]
    createTemporaryPath?: (filePath: string) => string
    sleep?: (milliseconds: number) => Promise<void>
}

type AtomicFileWriteOptions = {
    mode?: number
}

export function createAtomicFileWriter(options: AtomicFileWriterFactoryOptions = {}) {
    const fileSystem = options.fileSystem ?? fs
    const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RENAME_RETRY_DELAYS_MS
    const createTemporaryPath = options.createTemporaryPath
        ?? ((filePath: string) => `${filePath}.${process.pid}.${randomUUID()}.tmp`)
    const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds)
    }))
    const pendingWrites = new Map<string, Promise<void>>()

    return async function writeFileAtomicallyIfChanged(
        filePath: string,
        content: string,
        writeOptions: AtomicFileWriteOptions = {}
    ) {
        const queueKey = path.resolve(filePath)
        const previous = pendingWrites.get(queueKey) ?? Promise.resolve()
        const task = previous
            .catch(() => {})
            .then(async () => {
                const existingContent = await readTextIfPresent(fileSystem, filePath)
                if (existingContent === content) return

                const temporaryPath = createTemporaryPath(filePath)
                try {
                    await fileSystem.writeFile(temporaryPath, content, {
                        encoding: 'utf8',
                        mode: writeOptions.mode ?? 0o600,
                        flag: 'wx',
                    })
                    await renameWithRetry({
                        fileSystem,
                        sourcePath: temporaryPath,
                        destinationPath: filePath,
                        retryDelaysMs,
                        sleep,
                    })
                } finally {
                    await fileSystem.rm(temporaryPath, { force: true }).catch(() => {})
                }
            })

        pendingWrites.set(queueKey, task)
        return task.finally(() => {
            if (pendingWrites.get(queueKey) === task) pendingWrites.delete(queueKey)
        })
    }
}

export const writeFileAtomicallyIfChanged = createAtomicFileWriter()

async function readTextIfPresent(fileSystem: AtomicFileSystem, filePath: string) {
    try {
        return await fileSystem.readFile(filePath, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
    }
}

async function renameWithRetry(input: {
    fileSystem: AtomicFileSystem
    sourcePath: string
    destinationPath: string
    retryDelaysMs: readonly number[]
    sleep: (milliseconds: number) => Promise<void>
}) {
    let retryIndex = 0
    while (true) {
        try {
            await input.fileSystem.rename(input.sourcePath, input.destinationPath)
            return
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code ?? ''
            const retryDelay = input.retryDelaysMs[retryIndex]
            if (!RETRIABLE_RENAME_ERROR_CODES.has(code) || retryDelay === undefined) throw error
            retryIndex += 1
            await input.sleep(retryDelay)
        }
    }
}
