import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
    appendTermGalleryItem,
    resolveCodexArtifactGalleryImage,
    TermGalleryError,
} from './term-gallery'

test('appends a managed image to one term gallery without touching other terms', () => {
    const state = {
        entries: [
            { id: 'term-1', title: '阿洛' },
            { id: 'term-2', title: '林月', gallery: [{ id: 'existing', url: '/uploads/existing.png' }] },
        ],
    }

    const result = appendTermGalleryItem(state, 'term-1', '/uploads/portrait.png')

    assert.equal(result.changed, true)
    assert.equal(result.gallery.length, 1)
    assert.equal(result.gallery[0].url, '/uploads/portrait.png')
    assert.deepEqual(state.entries[1].gallery, [{ id: 'existing', url: '/uploads/existing.png' }])
})

test('does not append the same gallery URL twice', () => {
    const state = {
        entries: [{ id: 'term-1', gallery: [{ id: 'existing', url: '/uploads/portrait.png' }] }],
    }

    const result = appendTermGalleryItem(state, 'term-1', '/uploads/portrait.png')

    assert.equal(result.changed, false)
    assert.deepEqual(result.gallery, [{ id: 'existing', url: '/uploads/portrait.png' }])
})

test('rejects an unknown term id', () => {
    assert.throws(
        () => appendTermGalleryItem({ entries: [] }, 'missing', '/uploads/portrait.png'),
        (error: unknown) => error instanceof TermGalleryError && error.status === 404
    )
})

test('resolves a supported image inside the Codex artifacts directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-term-gallery-'))
    try {
        await fs.mkdir(path.join(root, 'images'))
        await fs.writeFile(path.join(root, 'images', 'portrait.png'), 'image')

        const result = await resolveCodexArtifactGalleryImage(root, 'images/portrait.png')

        assert.equal(result.realImagePath, await fs.realpath(path.join(root, 'images', 'portrait.png')))
        assert.equal(result.extension, '.png')
    } finally {
        await fs.rm(root, { recursive: true, force: true })
    }
})

test('rejects an image outside the Codex artifacts directory', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-term-gallery-'))
    try {
        const root = path.join(parent, 'artifacts')
        const outside = path.join(parent, 'outside.png')
        await fs.mkdir(root)
        await fs.writeFile(outside, 'image')

        await assert.rejects(
            resolveCodexArtifactGalleryImage(root, outside),
            (error: unknown) => error instanceof TermGalleryError && error.status === 400
        )
    } finally {
        await fs.rm(parent, { recursive: true, force: true })
    }
})
