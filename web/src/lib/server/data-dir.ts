import os from 'os'
import path from 'path'

export function getOpenNovelWriterDataDir() {
    const override = process.env.OPENNOVELWRITER_DATA_DIR
    if (override && override.trim()) return override.trim()

    if (process.platform === 'win32') {
        const base = process.env.APPDATA || os.homedir()
        return path.join(base, 'OpenNovelWriter')
    }

    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'OpenNovelWriter')
    }

    const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
    return path.join(base, 'opennovelwriter')
}
