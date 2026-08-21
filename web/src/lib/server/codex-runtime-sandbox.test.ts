import assert from 'node:assert/strict'
import path from 'path'
import { describe, test } from 'node:test'

import {
    getCodexRuntimeSandbox,
    getCodexRuntimeSandboxPolicy,
    getCodexRuntimeWorkspaceRoots,
} from './codex-runtime-sandbox'

const sessionWorkspacePath = '/tmp/onw/codex/sessions/owner/session'
const novelWorkspacePath = '/tmp/onw/codex/novels/owner/novel'

describe('getCodexRuntimeSandbox', () => {
    test('keeps workspace-write for every review level except full access', () => {
        assert.equal(getCodexRuntimeSandbox('user_review'), 'workspace-write')
        assert.equal(getCodexRuntimeSandbox('auto_review'), 'workspace-write')
        assert.equal(getCodexRuntimeSandbox('no_review'), 'workspace-write')
        assert.equal(getCodexRuntimeSandbox('full_access'), 'danger-full-access')
    })
})

describe('getCodexRuntimeWorkspaceRoots', () => {
    test('uses only the session workspace on macOS and Linux', () => {
        assert.deepEqual(
            getCodexRuntimeWorkspaceRoots({
                sessionWorkspacePath,
                novelWorkspacePath,
                platform: 'darwin',
            }),
            [path.resolve(sessionWorkspacePath)],
        )
        assert.deepEqual(
            getCodexRuntimeWorkspaceRoots({
                sessionWorkspacePath,
                novelWorkspacePath,
                platform: 'linux',
            }),
            [path.resolve(sessionWorkspacePath)],
        )
    })

    test('also includes the novel workspace on Windows so symlink targets stay readable', () => {
        assert.deepEqual(
            getCodexRuntimeWorkspaceRoots({
                sessionWorkspacePath,
                novelWorkspacePath,
                platform: 'win32',
            }),
            [path.resolve(sessionWorkspacePath), path.resolve(novelWorkspacePath)],
        )
    })
})

describe('getCodexRuntimeSandboxPolicy', () => {
    test('sends a complete workspaceWrite policy for no_review', () => {
        assert.deepEqual(
            getCodexRuntimeSandboxPolicy({
                reviewLevel: 'no_review',
                sessionWorkspacePath,
                novelWorkspacePath,
                platform: 'linux',
            }),
            {
                type: 'workspaceWrite',
                writableRoots: [path.resolve(sessionWorkspacePath)],
                networkAccess: false,
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false,
            },
        )
    })

    test('does not change full_access into a workspace-write policy', () => {
        assert.deepEqual(
            getCodexRuntimeSandboxPolicy({
                reviewLevel: 'full_access',
                sessionWorkspacePath,
                novelWorkspacePath,
                platform: 'win32',
            }),
            { type: 'dangerFullAccess' },
        )
    })
})
