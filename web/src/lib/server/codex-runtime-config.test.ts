import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { createDefaultCodexProviderModel } from '@/lib/codex-config'
import { syncCodexConnectionRuntimeFiles } from './codex-runtime-config'

test('enables hosted Anthropic search only for the official DeepSeek connection', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onw-runtime-search-'))
    const original = process.env.OPENNOVELWRITER_DATA_DIR
    process.env.OPENNOVELWRITER_DATA_DIR = directory
    try {
        for (const [id, baseUrl, mode] of [
            ['deepseek', 'https://api.deepseek.com/anthropic', 'live'],
            ['anthropic', 'https://api.anthropic.com', 'disabled'],
            ['aggregator', 'https://api.deepseek.com.example/anthropic', 'disabled'],
        ]) {
            const home = await syncCodexConnectionRuntimeFiles({
                id, ownerId: 'test', providerType: 'custom', upstreamFormat: 'anthropic-messages',
                baseUrl, defaultModelId: 'deepseek-flash', modelsJson: JSON.stringify([createDefaultCodexProviderModel('deepseek-flash')]),
            })
            const config = await fs.readFile(path.join(home, 'config.toml'), 'utf8')
            assert.ok(config.includes(`web_search = "${mode}"`))
            const catalog = JSON.parse(await fs.readFile(path.join(home, 'opennovelwriter-model-catalog.json'), 'utf8'))
            assert.equal(catalog.models[0].web_search_tool_type, mode === 'live' ? 'text' : undefined)
        }
    } finally {
        if (original === undefined) delete process.env.OPENNOVELWRITER_DATA_DIR
        else process.env.OPENNOVELWRITER_DATA_DIR = original
        await fs.rm(directory, { recursive: true, force: true })
    }
})
