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

test('validates GPT Image 2.5 sizes and normalizes direct requests', () => {
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
        quality: 'auto',
        n: 1,
        background: null,
        outputFormat: 'png',
        outputCompression: null,
        moderation: null,
        inputFidelity: null,
    }])
})

test('supports GPT Image 2.5 quality, transparency, fidelity, and image sources', () => {
    const batch = normalizeGptImageBatch({
        quality: 'xhigh',
        background: 'transparent',
        inputFidelity: 'high',
        items: [
            { prompt: 'Edit the scene.', images: [{ imageUrl: 'https://example.com/source.png' }] },
            { prompt: 'Edit again.', quality: 'max', inputFidelity: 'low', outputFormat: 'webp', images: [{ fileId: 'file-source' }], mask: { fileId: 'file-mask' } },
        ],
    })
    assert.equal(batch.items[0].quality, 'xhigh')
    assert.equal(batch.items[0].inputFidelity, 'high')
    assert.equal(batch.items[1].quality, 'max')
    assert.equal(batch.items[1].inputFidelity, 'low')
    assert.equal(batch.items[1].background, 'transparent')
    assert.deepEqual(batch.items[1].mask, { fileId: 'file-mask' })
    assert.throws(() => normalizeGptImageDirect({ prompt: 'test', background: 'transparent', outputFormat: 'jpeg' }), /require png or webp/)
    assert.throws(() => normalizeGptImageDirect({ prompt: 'test', inputFidelity: 'auto' }), /inputFidelity/)
    for (const image of [{}, { path: 'a.png', fileId: 'file-a' }, { imageUrl: 'https://example.com/a.png', fileId: 'file-a' }]) {
        assert.throws(() => normalizeGptImageDirect({ prompt: 'test', images: [image] }), /exactly one/)
    }
    assert.throws(() => normalizeGptImageDirect({ prompt: 'test', images: [{ imageUrl: 'file:///tmp/a.png' }] }), /HTTP\(S\)/)
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
                quality: 'max',
                background: 'transparent',
                inputFidelity: 'high',
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
            quality: 'auto',
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
        assert.match(multipart, /name="quality"\r\n\r\nmax/)
        assert.match(multipart, /name="background"\r\n\r\ntransparent/)
        assert.match(multipart, /name="input_fidelity"\r\n\r\nhigh/)

        const dataUrl = `data:image/png;base64,${Buffer.from('inline-image').toString('base64')}`
        for (const [index, sources] of [
            [{ imageUrl: 'https://example.com/source.png' }, { fileId: 'file-source' }],
            [{ path: 'image-inputs/source.png' }, { imageUrl: dataUrl }],
        ].entries()) {
            await generateCodexImageArtifactsWithProvider({
                ownerId: 'owner-1',
                sessionId: 'session-1',
                directoryPath: path.join(artifactsRoot, 'images', `remote-${index}`),
                batch: normalizeGptImageDirect({
                    prompt: 'Edit the scene.',
                    images: sources,
                    mask: index === 0 ? { fileId: 'file-mask' } : { imageUrl: dataUrl },
                    quality: 'xhigh',
                    inputFidelity: index === 0 ? 'low' : undefined,
                    background: 'transparent',
                    outputFormat: 'webp',
                    outputCompression: 80,
                }),
            }, provider)
            const request = requests[index + 2]
            assert.equal(request.url, '/images/edits')
            assert.equal(request.authorization, 'Bearer test-image-key')
            assert.match(request.contentType, /^application\/json/)
            assert.deepEqual(JSON.parse(request.body.toString('utf8')), {
                model: 'upstream-image-model',
                prompt: 'Edit the scene.',
                size: 'auto',
                quality: 'xhigh',
                n: 1,
                background: 'transparent',
                output_format: 'webp',
                output_compression: 80,
                ...(index === 0 ? { input_fidelity: 'low' } : {}),
                images: index === 0
                    ? [{ image_url: 'https://example.com/source.png' }, { file_id: 'file-source' }]
                    : [{ image_url: `data:image/png;base64,${Buffer.from('source-image').toString('base64')}` }, { image_url: dataUrl }],
                mask: index === 0 ? { file_id: 'file-mask' } : { image_url: dataUrl },
            })
            const remoteManifest = JSON.parse(await fs.readFile(path.join(artifactsRoot, 'images', `remote-${index}`, 'manifest.json'), 'utf8'))
            assert.deepEqual(remoteManifest.items[0].references, index === 0
                ? sources
                : [{ file: 'image-inputs/source.png' }, { imageUrl: dataUrl }])
        }
        assert.equal(requests.length, 4)
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
        if (previousDataDir === undefined) delete process.env.OPENNOVELWRITER_DATA_DIR
        else process.env.OPENNOVELWRITER_DATA_DIR = previousDataDir
        await fs.rm(dataDir, { recursive: true, force: true })
    }
})
