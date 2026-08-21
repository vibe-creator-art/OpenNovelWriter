import path from 'path'

import type { CodexReviewLevel } from '@/lib/server/codex-session'

export type CodexSandboxMode = 'workspace-write' | 'danger-full-access'

export type CodexWorkspaceWriteSandboxPolicy = {
    type: 'workspaceWrite'
    writableRoots: string[]
    networkAccess: false
    excludeTmpdirEnvVar: false
    excludeSlashTmp: false
}

export type CodexDangerFullAccessSandboxPolicy = {
    type: 'dangerFullAccess'
}

export type CodexRuntimeSandboxPolicy =
    | CodexWorkspaceWriteSandboxPolicy
    | CodexDangerFullAccessSandboxPolicy

export function getCodexRuntimeSandbox(reviewLevel: CodexReviewLevel): CodexSandboxMode {
    return reviewLevel === 'full_access' ? 'danger-full-access' : 'workspace-write'
}

export function getCodexRuntimeWorkspaceRoots(input: {
    sessionWorkspacePath: string
    novelWorkspacePath: string
    platform?: NodeJS.Platform
}): string[] {
    const sessionRoot = path.resolve(input.sessionWorkspacePath)
    const platform = input.platform ?? process.platform
    if (platform !== 'win32') return [sessionRoot]

    const novelRoot = path.resolve(input.novelWorkspacePath)
    if (novelRoot === sessionRoot) return [sessionRoot]
    return [sessionRoot, novelRoot]
}

export function getCodexRuntimeSandboxPolicy(input: {
    reviewLevel: CodexReviewLevel
    sessionWorkspacePath: string
    novelWorkspacePath: string
    platform?: NodeJS.Platform
}): CodexRuntimeSandboxPolicy {
    if (input.reviewLevel === 'full_access') {
        return { type: 'dangerFullAccess' }
    }

    return {
        type: 'workspaceWrite',
        writableRoots: getCodexRuntimeWorkspaceRoots(input),
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
    }
}
