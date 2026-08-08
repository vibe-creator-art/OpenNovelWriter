import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
    generateCodexImageArtifactsWithProvider,
    normalizeGptImageBatch,
    normalizeGptImageDirect,
    validateGptImageSize,
} from './gpt-image'

test('validates GPT Image 2 sizes and normalizes direct requests', () => {
    assert.equal(validateGptImageSize('auto'), 'auto')
    assert.equal(validateGptImageSize('2048x1152'), '2048x1152')
    assert.throws(() => validateGptImageSize('1025x1024'), /multiples of 16/)
    assert.throws(() => validateGptImageSize('256x256'), /total pixels/)

    const batch = normalizeGptImageDirect({
        prompt: 'Paint a moonlit mountain village.',
        title: 'Village concept',
        id: 'Village Concept',
        images: [{ path: 'image-inputs/layout.png', role: 'composition reference' }],
    })

    assert.equal(batch.title, 'Village concept')
    assert.deepEqual(batch.items, [{
        id: 'village-concept',
        label: 'village-concept',
        prompt: 'Paint a moonlit mountain village.',
        images: [{ path: 'image-inputs/layout.png', role: 'composition reference' }],
        mask: null,
        size: 'auto',
        quality: 'high',
        n: 1,
        background: null,
        outputFormat: 'png',
        outputCompression: null,
        moderation: null,
    }])
})

test('applies batch defaults, item overrides, and image count limits', () => {
    const batch = normalizeGptImageBatch({
        title: 'NPC portraits',
        size: '1024x1024',
        quality: 'medium',
        outputFormat: 'webp',
        outputCompression: 80,
        items: [
            { id: 'guard', label: 'Guard', prompt: 'Portrait of the city guard.' },
            { id: 'mage', label: 'Mage', prompt: 'Portrait of the court mage.', quality: 'high', n: 2 },
        ],
    })

    assert.equal(batch.items[0].quality, 'medium')
    assert.equal(batch.items[0].outputFormat, 'webp')
    assert.equal(batch.items[0].outputCompression, 80)
    assert.equal(batch.items[1].quality, 'high')
    assert.equal(batch.items[1].n, 2)
    assert.throws(
        () => normalizeGptImageBatch({
            items: Array.from({ length: 7 }, (_, index) => ({
                id: `npc-${index}`,
                prompt: `NPC ${index}`,
                n: 10,
            })),
        }),
        /at most 64 images/
    )
})

test('calls generation and edit endpoints and writes reusable image artifacts', async () => {
    const previousDataDir = process.env.OPENNOVELWRITER_DATA_DIR
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-gpt-image-'))
    const requests: Array<{ url: string; authorization: string | undefined; contentType: string; body: Buffer }> = []
    const responseBytes = Buffer.from('generated-image')
    const server = http.createServer(async (request, response) => {
        const body: Buffer[] = []
        for await (const chunk of request) body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        requests.push({
            url: request.url ?? '',
            authorization: request.headers.authorization,
            contentType: request.headers['content-type'] ?? '',
            body: Buffer.concat(body),
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
            data: [{ b64_json: responseBytes.toString('base64'), revised_prompt: 'Provider revised prompt' }],
        }))
    })

    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => resolve())
        })
        const address = server.address() as AddressInfo
        process.env.OPENNOVELWRITER_DATA_DIR = dataDir
        const provider = {
            apiKey: 'test-image-key',
            baseUrl: `http://127.0.0.1:${address.port}`,
            modelId: 'upstream-image-model',
        }

        const artifactsRoot = path.join(dataDir, 'codex', 'sessions', 'owner-1', 'session-1', 'artifacts')
        await fs.mkdir(path.join(artifactsRoot, 'image-inputs'), { recursive: true })
        await fs.writeFile(path.join(artifactsRoot, 'image-inputs', 'source.png'), Buffer.from('source-image'))

        const generated = await generateCodexImageArtifactsWithProvider({
            ownerId: 'owner-1',
            sessionId: 'session-1',
            directoryPath: path.join(artifactsRoot, 'images', 'cover'),
            batch: normalizeGptImageDirect({
                title: 'Cover [draft]',
                id: 'cover',
                label: 'Cover',
                prompt: 'A storm over an ancient city.',
            }),
        }, provider)
        const edited = await generateCodexImageArtifactsWithProvider({
            ownerId: 'owner-1',
            sessionId: 'session-1',
            directoryPath: path.join(artifactsRoot, 'images', 'cover-edit'),
            batch: normalizeGptImageDirect({
                title: 'Cover edit',
                id: 'cover-edit',
                label: 'Cover edit',
                prompt: 'Make the storm more dramatic.',
                images: [{ path: 'image-inputs/source.png', role: 'edit target' }],
            }),
        }, provider)

        assert.equal(generated.suggestedLink, '[Cover draft](image:images/cover/manifest.json)')
        assert.equal(generated.items[0].ref, 'image:images/cover/manifest.json#cover')
        assert.equal(edited.suggestedLink, '[Cover edit](image:images/cover-edit/manifest.json)')
        assert.deepEqual(await fs.readFile(path.join(artifactsRoot, 'images', 'cover', 'cover.png')), responseBytes)

        const manifest = JSON.parse(await fs.readFile(
            path.join(artifactsRoot, 'images', 'cover-edit', 'manifest.json'),
            'utf8'
        )) as { model: string; items: Array<{ mode: string; references: Array<{ file: string; role: string }> }> }
        assert.equal(manifest.model, 'upstream-image-model')
        assert.equal(manifest.items[0].mode, 'edit')
        assert.deepEqual(manifest.items[0].references, [{ file: 'image-inputs/source.png', role: 'edit target' }])

        assert.equal(requests.length, 2)
        assert.equal(requests[0].url, '/images/generations')
        assert.equal(requests[0].authorization, 'Bearer test-image-key')
        assert.match(requests[0].contentType, /^application\/json/)
        assert.deepEqual(JSON.parse(requests[0].body.toString('utf8')), {
            model: 'upstream-image-model',
            prompt: 'A storm over an ancient city.',
            size: 'auto',
            quality: 'high',
            n: 1,
            output_format: 'png',
        })
        assert.equal(requests[1].url, '/images/edits')
        assert.equal(requests[1].authorization, 'Bearer test-image-key')
        assert.match(requests[1].contentType, /^multipart\/form-data; boundary=/)
        const multipart = requests[1].body.toString('utf8')
        assert.match(multipart, /name="image\[\]"/)
        assert.match(multipart, /upstream-image-model/)
        assert.match(multipart, /Input image roles:/)
        assert.match(multipart, /Image 1: edit target/)
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
        if (previousDataDir === undefined) delete process.env.OPENNOVELWRITER_DATA_DIR
        else process.env.OPENNOVELWRITER_DATA_DIR = previousDataDir
        await fs.rm(dataDir, { recursive: true, force: true })
    }
})
