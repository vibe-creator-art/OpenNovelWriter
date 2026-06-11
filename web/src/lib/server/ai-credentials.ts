import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getOpenNovelWriterDataDir } from '@/lib/server/data-dir'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const VERSION = 1

function secretFilePath() {
    return path.join(getOpenNovelWriterDataDir(), 'ai_credentials_secret')
}

function loadOrCreateSecret() {
    const fromEnv = process.env.AI_CREDENTIALS_SECRET
    if (fromEnv && fromEnv.trim()) return fromEnv.trim()

    const file = secretFilePath()
    try {
        const existing = fs.readFileSync(file, 'utf8').trim()
        if (existing) return existing
    } catch {
        // ignore and create below
    }

    const secret = crypto.randomBytes(32).toString('base64url')

    try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`
        fs.writeFileSync(tmp, `${secret}\n`, { encoding: 'utf8', mode: 0o600 })
        fs.renameSync(tmp, file)
        return secret
    } catch {
        throw new Error(
            'Missing AI_CREDENTIALS_SECRET (and failed to persist an auto-generated secret). ' +
            'Set AI_CREDENTIALS_SECRET in the runtime environment.'
        )
    }
}

function getKey() {
    const secret = loadOrCreateSecret()
    return crypto.createHash('sha256').update(secret, 'utf8').digest()
}

export function encryptApiKey(apiKey: string) {
    const trimmed = apiKey.trim()
    if (!trimmed) {
        throw new Error('Empty apiKey')
    }

    const key = getKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    const ciphertext = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]).toString('base64')
}

export function decryptApiKey(payload: string) {
    const data = Buffer.from(payload, 'base64')
    if (data.length < 1 + IV_LENGTH + TAG_LENGTH) {
        throw new Error('Invalid encrypted apiKey')
    }

    const version = data.readUInt8(0)
    if (version !== VERSION) {
        throw new Error('Unsupported encrypted apiKey version')
    }

    const iv = data.subarray(1, 1 + IV_LENGTH)
    const tag = data.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH)
    const ciphertext = data.subarray(1 + IV_LENGTH + TAG_LENGTH)

    const key = getKey()
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return plaintext
}
