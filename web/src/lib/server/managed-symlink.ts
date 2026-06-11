import fs from 'fs/promises'
import path from 'path'

export async function ensureManagedFileSymlink(input: {
    source: string
    destination: string
    managedSourceRoot: string
}) {
    await fs.mkdir(path.dirname(input.destination), { recursive: true })

    const existing = await readExistingSymlink(input.destination)
    if (existing) {
        const resolvedTarget = path.resolve(path.dirname(input.destination), existing)
        if (!isInsideDirectory(resolvedTarget, input.managedSourceRoot)) {
            throw new Error(`Cannot sync ${path.basename(input.destination)} because the existing symlink is not managed by OpenNovelWriter.`)
        }
        if (resolvedTarget === path.resolve(input.source)) {
            await chmodReadonlySymlink(input.destination)
            return
        }
        await fs.unlink(input.destination)
    } else if (await pathExists(input.destination)) {
        throw new Error(`Cannot sync ${path.basename(input.destination)} because a non-symlink file already exists.`)
    }

    await fs.symlink(path.relative(path.dirname(input.destination), input.source), input.destination, 'file')
    await chmodReadonlySymlink(input.destination)
}

export async function removeManagedSymlink(input: {
    destination: string
    managedSourceRoot: string
}) {
    const existing = await readExistingSymlink(input.destination)
    if (!existing) return

    const resolvedTarget = path.resolve(path.dirname(input.destination), existing)
    if (isInsideDirectory(resolvedTarget, input.managedSourceRoot)) {
        await fs.unlink(input.destination)
    }
}

async function readExistingSymlink(filePath: string) {
    try {
        const stats = await fs.lstat(filePath)
        if (!stats.isSymbolicLink()) return null
        return fs.readlink(filePath)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
    }
}

async function pathExists(filePath: string) {
    try {
        await fs.access(filePath)
        return true
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
    }
}

function isInsideDirectory(target: string, directory: string) {
    const relative = path.relative(path.resolve(directory), path.resolve(target))
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

async function chmodReadonlySymlink(filePath: string) {
    await fs.lchmod(filePath, 0o555).catch((error) => {
        const code = (error as NodeJS.ErrnoException).code
        if (
            code === 'ENOENT' ||
            code === 'ERR_METHOD_NOT_IMPLEMENTED' ||
            code === 'ENOSYS' ||
            code === 'ENOTSUP' ||
            code === 'EOPNOTSUPP' ||
            code === 'EINVAL' ||
            code === 'EACCES' ||
            code === 'EPERM'
        ) {
            return
        }
        throw error
    })
}
