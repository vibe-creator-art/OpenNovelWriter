export type CodexApprovalKind = 'command' | 'file' | 'permissions' | 'elicitation' | 'tool' | 'unknown'

export type CodexApprovalOption = 'accept' | 'acceptForSession' | 'acceptWithPolicy' | 'decline' | 'cancel' | 'steer'

export type CodexApprovalRequest = {
    id: string
    sessionId: string
    threadId: string | null
    turnId: string | null
    kind: CodexApprovalKind
    title: string
    detail: string
    command: string | null
    cwd: string | null
    server: string | null
    tool: string | null
    proposedPolicy: string[] | null
    options: CodexApprovalOption[]
    createdAt: string
}

export type CodexApprovalDecision = {
    decision: CodexApprovalOption
    message?: string
}

type PendingCodexApproval = {
    request: CodexApprovalRequest
    resolve: (decision: CodexApprovalDecision) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
}

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000

const CODEX_APPROVAL_STATE_KEY = Symbol.for('openNovelWriter.codexApprovalState')

type CodexApprovalState = {
    pendingApprovals: Map<string, PendingCodexApproval>
    sessionApprovalCache: Map<string, Set<string>>
}

type CodexApprovalGlobal = typeof globalThis & {
    [CODEX_APPROVAL_STATE_KEY]?: CodexApprovalState
}

const codexApprovalState = ((globalThis as CodexApprovalGlobal)[CODEX_APPROVAL_STATE_KEY] ??= {
    pendingApprovals: new Map<string, PendingCodexApproval>(),
    sessionApprovalCache: new Map<string, Set<string>>(),
})

const { pendingApprovals, sessionApprovalCache } = codexApprovalState

export function createCodexApprovalRequest(input: {
    sessionId: string
    requestId: string
    method: string
    params: Record<string, unknown>
}) {
    const threadId = getString(input.params.threadId)
    const turnId = getString(input.params.turnId)
    const now = new Date().toISOString()
    const base = {
        id: `${input.sessionId}:${input.requestId}`,
        sessionId: input.sessionId,
        threadId,
        turnId,
        command: null,
        cwd: getString(input.params.cwd),
        server: null,
        tool: null,
        proposedPolicy: getStringArray(input.params.proposedExecpolicyAmendment),
        createdAt: now,
    }

    if (input.method === 'item/commandExecution/requestApproval') {
        const command = getString(input.params.command)
        const prefix = getStringArray(input.params.proposedExecpolicyAmendment)
        return {
            ...base,
            kind: 'command' as const,
            title: command ? `Allow command: ${command}` : 'Allow command execution?',
            detail: getString(input.params.reason) ?? '',
            command,
            proposedPolicy: prefix,
            options: getApprovalOptions(Boolean(prefix?.length), true),
        }
    }

    if (input.method === 'item/fileChange/requestApproval') {
        return {
            ...base,
            kind: 'file' as const,
            title: 'Allow file changes?',
            detail: getString(input.params.reason) ?? '',
            options: getApprovalOptions(false, true),
        }
    }

    if (input.method === 'item/permissions/requestApproval') {
        return {
            ...base,
            kind: 'permissions' as const,
            title: 'Allow additional permissions?',
            detail: getString(input.params.reason) ?? JSON.stringify(input.params.permissions ?? null, null, 2),
            options: getApprovalOptions(false, true),
        }
    }

    if (input.method === 'mcpServer/elicitation/request') {
        const serverName = getString(input.params.serverName)
        const message = getString(input.params.message) ?? ''
        const toolName = getMcpToolNameFromElicitationMessage(message)
        return {
            ...base,
            kind: 'elicitation' as const,
            title: serverName ? `Allow ${serverName} request?` : 'Allow MCP request?',
            detail: message,
            server: serverName,
            tool: toolName,
            options: getApprovalOptions(false, true),
        }
    }

    if (input.method === 'item/tool/call') {
        const namespace = getString(input.params.namespace)
        const tool = getString(input.params.tool)
        return {
            ...base,
            kind: 'tool' as const,
            title: namespace && tool ? `Allow ${namespace}.${tool}?` : tool ? `Allow ${tool}?` : 'Allow tool call?',
            detail: JSON.stringify(input.params.arguments ?? null, null, 2),
            server: namespace,
            tool,
            options: getApprovalOptions(false, true),
        }
    }

    return {
        ...base,
        kind: 'unknown' as const,
        title: `Allow ${input.method}?`,
        detail: JSON.stringify(input.params, null, 2),
        options: ['accept', 'decline', 'cancel', 'steer'] as CodexApprovalOption[],
    }
}

export function waitForCodexApprovalDecision(request: CodexApprovalRequest) {
    return new Promise<CodexApprovalDecision>((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingApprovals.delete(request.id)
            reject(new Error('Approval request timed out.'))
        }, APPROVAL_TIMEOUT_MS)

        pendingApprovals.set(request.id, {
            request,
            resolve,
            reject,
            timeout,
        })
    })
}

export function isCodexApprovalRemembered(request: CodexApprovalRequest) {
    const cacheKey = getCodexApprovalCacheKey(request)
    if (!cacheKey) return false
    return sessionApprovalCache.get(request.sessionId)?.has(cacheKey) === true
}

export function rememberCodexApprovalForSession(request: CodexApprovalRequest) {
    const cacheKey = getCodexApprovalCacheKey(request)
    if (!cacheKey) return
    const existing = sessionApprovalCache.get(request.sessionId) ?? new Set<string>()
    existing.add(cacheKey)
    sessionApprovalCache.set(request.sessionId, existing)
}

export async function resolveCodexApprovalRequest(input: {
    sessionId: string
    approvalId: string
    decision: CodexApprovalOption
    message?: string
}) {
    const pending = pendingApprovals.get(input.approvalId)
    if (!pending || pending.request.sessionId !== input.sessionId) {
        return { ok: false as const, detail: 'Approval request is no longer pending.' }
    }

    if (input.decision === 'steer') {
        const message = typeof input.message === 'string' ? input.message.trim() : ''
        if (!message) {
            return { ok: false as const, detail: 'Steer message is required.' }
        }
    }

    pendingApprovals.delete(input.approvalId)
    clearTimeout(pending.timeout)
    pending.resolve({ decision: input.decision, message: input.message })
    return { ok: true as const }
}

function getApprovalOptions(hasPolicy: boolean, canRememberForSession: boolean) {
    const options: CodexApprovalOption[] = ['accept']
    if (canRememberForSession) options.push('acceptForSession')
    if (hasPolicy) options.push('acceptWithPolicy')
    options.push('decline', 'cancel', 'steer')
    return options
}

function getString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getStringArray(value: unknown) {
    if (!Array.isArray(value)) return null
    const items = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
    return items.length ? items : null
}

function getMcpToolNameFromElicitationMessage(message: string) {
    const match = message.match(/run tool\s+"([^"]+)"/iu)
    return match?.[1]?.trim() || null
}

function getCodexApprovalCacheKey(request: CodexApprovalRequest) {
    if (request.kind === 'command' && request.command) return `command:${request.command}`
    if (request.kind === 'file') return `file:${request.cwd ?? ''}`
    if (request.kind === 'permissions') return `permissions:${request.detail}`
    if ((request.kind === 'elicitation' || request.kind === 'tool') && (request.server || request.tool)) {
        return `${request.kind}:${request.server ?? ''}:${request.tool ?? request.detail}`
    }
    return null
}
