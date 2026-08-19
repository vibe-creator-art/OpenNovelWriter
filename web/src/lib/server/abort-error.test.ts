import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { isAbortError } from './abort-error'

describe('isAbortError', () => {
    test('matches DOMException and Error named AbortError', () => {
        assert.equal(isAbortError(new DOMException('Aborted', 'AbortError')), true)
        assert.equal(isAbortError(Object.assign(new Error('Aborted'), { name: 'AbortError' })), true)
    })

    test('matches Next.js ResponseAborted by name or constructor', () => {
        const named = Object.assign(new Error('The request was aborted.'), { name: 'ResponseAborted' })
        assert.equal(isAbortError(named), true)

        class ResponseAborted extends Error {}
        assert.equal(isAbortError(new ResponseAborted('The request was aborted.')), true)
    })

    test('treats an aborted signal as cancel even for unrelated errors', () => {
        const controller = new AbortController()
        controller.abort()
        assert.equal(isAbortError(new TypeError('Invalid state: Controller is already closed'), controller.signal), true)
        assert.equal(isAbortError(new TypeError('Invalid state: Controller is already closed')), false)
    })

    test('ignores ordinary failures', () => {
        assert.equal(isAbortError(new Error('fetch failed')), false)
        assert.equal(isAbortError('boom'), false)
        assert.equal(isAbortError(null), false)
    })
})
