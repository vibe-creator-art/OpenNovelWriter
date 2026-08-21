import { randomInt, timingSafeEqual } from 'node:crypto'

type ResetRecord = {
    code: string
    expiresAt: number
    attempts: number
}

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const resets = new Map<string, ResetRecord>()

function randomCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function codesMatch(left: string, right: string) {
    const a = Buffer.from(left)
    const b = Buffer.from(right)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
}

export function issuePasswordResetCode(username: string) {
    const code = randomCode()
    resets.set(username, {
        code,
        expiresAt: Date.now() + CODE_TTL_MS,
        attempts: 0,
    })
    return code
}

export function printPasswordResetCode(username: string, code: string) {
    const lines = [
        '',
        '================================================',
        ' OpenNovelWriter 密码重置授权码',
        ` 用户：${username}`,
        ` 授权码：${code}`,
        ' 有效期 10 分钟',
        '================================================',
        '',
    ]
    process.stdout.write(`${lines.join('\n')}\n`)
}

export function consumePasswordResetCode(username: string, code: string) {
    const record = resets.get(username)
    if (!record) return 'invalid' as const
    if (Date.now() > record.expiresAt) {
        resets.delete(username)
        return 'expired' as const
    }
    record.attempts += 1
    if (record.attempts > MAX_ATTEMPTS) {
        resets.delete(username)
        return 'invalid' as const
    }
    if (!codesMatch(record.code, code.trim())) return 'invalid' as const
    resets.delete(username)
    return 'ok' as const
}
