import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'

import {
    fetchGptImageModels,
    normalizeGptImageBaseUrl,
    normalizeGptImageModels,
} from './gpt-image-connection'

test('normalizes GPT Image connection values and keeps image models only', () => {
    const baseUrl = normalizeGptImageBaseUrl('https://api.openai.com/v1///')
    assert.equal(baseUrl, 'https://api.openai.com/v1')
    assert.throws(() => normalizeGptImageBaseUrl('file:///tmp/image-api'), /HTTP or HTTPS/)
    assert.deepEqual(normalizeGptImageModels([
        { id: 'gpt-5.6' },
        { id: 'gpt-image-2' },
        { id: 'gpt-image-2' },
        { id: 'gpt-image-1-mini' },
    ], baseUrl), [
        { id: 'gpt-image-2', name: 'gpt-image-2' },
        { id: 'gpt-image-1-mini', name: 'gpt-image-1-mini' },
    ])
})

test('fetches image models with bearer authentication', async () => {
    const requests: Array<{ url: string; authorization: string | undefined }> = []
    const server = http.createServer((request, response) => {
        requests.push({
            url: request.url ?? '',
            authorization: request.headers.authorization,
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
            data: [{ id: 'gpt-5.6' }, { id: 'gpt-image-2' }],
        }))
    })

    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => resolve())
        })
        const address = server.address() as AddressInfo
        const models = await fetchGptImageModels({
            baseUrl: `http://127.0.0.1:${address.port}`,
            apiKey: 'image-key',
        })

        assert.deepEqual(models, [{ id: 'gpt-image-2', name: 'gpt-image-2' }])
        assert.deepEqual(requests, [{ url: '/models', authorization: 'Bearer image-key' }])
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }
})
