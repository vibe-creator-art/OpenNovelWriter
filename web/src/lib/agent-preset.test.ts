import assert from 'node:assert/strict'
import test from 'node:test'

import {
    AGENT_PRESET_SCHEMA,
    createAgentPresetKey,
    getNextAgentPresetRevision,
    parseAgentPresetAsset,
} from './agent-preset'

test('parses a valid agent preset without enabled', () => {
    const parsed = parseAgentPresetAsset({
        schema: AGENT_PRESET_SCHEMA,
        version: 1,
        metadata: {
            presetId: 'agent-outline',
            name: '大纲助手',
            description: 'Focus on outlining',
            revision: 1,
            exportedAt: '2026-08-13T00:00:00.000Z',
        },
        agent: 'agent',
    })

    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.preset.metadata.presetId, 'agent-outline')
    assert.equal(parsed.preset.agent, 'agent')
    assert.equal('enabled' in parsed.preset.metadata, false)
})

test('ignores extra enabled field on agent presets', () => {
    const parsed = parseAgentPresetAsset({
        schema: AGENT_PRESET_SCHEMA,
        version: 1,
        metadata: {
            presetId: 'agent-outline',
            name: '大纲助手',
            description: null,
            revision: 1,
            enabled: true,
            exportedAt: '2026-08-13T00:00:00.000Z',
        },
        agent: 'agent',
    })

    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal('enabled' in parsed.preset.metadata, false)
})

test('rejects missing agent directory and increments revision by 0.1', () => {
    const parsed = parseAgentPresetAsset({
        schema: AGENT_PRESET_SCHEMA,
        version: 1,
        metadata: {
            presetId: 'agent-outline',
            name: '大纲助手',
            revision: 1.2,
        },
        agent: '../escape',
    })

    assert.equal(parsed.ok, false)
    assert.equal(getNextAgentPresetRevision(1.2), 1.3)
    assert.match(createAgentPresetKey('大纲助手'), /^agent-[a-z0-9]+$/)
})
