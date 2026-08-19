/** Next.js throws this when a client drops a streaming response. */
const ABORT_ERROR_NAMES = new Set(['AbortError', 'ResponseAborted'])

export function isAbortError(error: unknown, signal?: AbortSignal | null) {
    if (signal?.aborted) return true
    if (typeof error !== 'object' || error === null) return false

    const name = 'name' in error && typeof (error as { name?: unknown }).name === 'string'
        ? (error as { name: string }).name
        : ''
    if (ABORT_ERROR_NAMES.has(name)) return true

    return error.constructor?.name === 'ResponseAborted'
}
