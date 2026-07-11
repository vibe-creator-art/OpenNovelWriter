import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { getPrismaClient } from '@/lib/db'
import { resolveManagedUploadPath, saveImageBuffer } from '@/lib/server/storage'
import { DEFAULT_CODEX_MODEL } from '@/lib/codex-config'
import { ensureCodexConnectionHome } from '@/lib/server/codex-connection-storage'
import { syncCodexConnectionRuntimeFiles } from '@/lib/server/codex-runtime-config'
import { syncCodexConnectionMcp } from '@/lib/server/codex-mcp-sync'
import { ensureCodexSessionWorkspace } from '@/lib/server/codex-session-workspace'
import {
    createCodexApprovalRequest,
    isCodexApprovalRemembered,
    rememberCodexApprovalForSession,
    waitForCodexApprovalDecision,
    type CodexApprovalDecision,
    type CodexApprovalRequest,
} from '@/lib/server/codex-approval-bridge'
import {
    DEFAULT_CODEX_REVIEW_LEVEL,
    DEFAULT_CODEX_REASONING_EFFORT,
    DEFAULT_CODEX_SERVICE_TIER,
    type CodexContextWindow,
    normalizeCodexReasoningEffort,
    normalizeCodexReviewLevel,
    normalizeCodexServiceTier,
    type CodexReviewLevel,
} from '@/lib/server/codex-session'

type JsonRpcMessage =
    | { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message?: string } }

type CodexAccountInfo =
    | {
        status: 'authenticated'
        authType: string
        accountEmail: string | null
        accountPlan: string | null
        lastAuthError: null
    }
    | {
        status: 'unauthenticated'
        authType: null
        accountEmail: null
        accountPlan: null
        lastAuthError: null
    }
    | {
        status: 'error'
        authType: null
        accountEmail: null
        accountPlan: null
        lastAuthError: string
    }

type PendingRequest = {
    resolve: (value: unknown) => void
    reject: (reason: Error) => void
}

type ServerRequestHandler = (message: JsonRpcMessage) => Promise<unknown> | unknown

type LoginSessionStatus = 'authorizing' | 'authenticated' | 'unauthenticated' | 'error'

type LoginSessionRecord = {
    connectionId: string
    ownerId: string
    loginId: string
    type: 'chatgpt' | 'chatgptDeviceCode'
    authUrl: string | null
    verificationUrl: string | null
    userCode: string | null
    codexHome: string
    client: CodexAppServerClient
    status: LoginSessionStatus
    error: string | null
    startedAt: number
    completedAt: number | null
}

const SESSION_TTL_MS = 10 * 60 * 1000
const CODEX_PLAN_MODE_REASONING_EFFORT = 'medium'
const loginSessions = new Map<string, LoginSessionRecord>()
const CODEX_ACTIVE_RUN_STATE_KEY = Symbol.for('openNovelWriter.codexActiveRunState')
const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

type ActiveCodexRunHandle = {
    sessionId: string
    client: CodexAppServerClient
    threadId: string
    turnId: string
    emitEvent: (event: CodexRunEvent) => void
}

type CodexActiveRunState = {
    activeRuns: Map<string, ActiveCodexRunHandle>
}

type CodexActiveRunGlobal = typeof globalThis & {
    [CODEX_ACTIVE_RUN_STATE_KEY]?: CodexActiveRunState
}

const codexActiveRunState = ((globalThis as CodexActiveRunGlobal)[CODEX_ACTIVE_RUN_STATE_KEY] ??= {
    activeRuns: new Map<string, ActiveCodexRunHandle>(),
})

const { activeRuns } = codexActiveRunState

export function getActiveCodexRun(sessionId: string) {
    return activeRuns.get(sessionId) ?? null
}

function registerActiveCodexRun(handle: ActiveCodexRunHandle) {
    activeRuns.set(handle.sessionId, handle)
}

function clearActiveCodexRun(sessionId: string, handle?: ActiveCodexRunHandle) {
    const current = activeRuns.get(sessionId)
    if (!current) return
    if (handle && current !== handle) return
    activeRuns.delete(sessionId)
}

export async function steerActiveCodexRun(input: {
    sessionId: string
    message: string
    attachments?: string[]
}) {
    const activeRun = getActiveCodexRun(input.sessionId)
    if (!activeRun) {
        throw new Error('No active Codex turn is available.')
    }

    const content = input.message.trim()
    if (!content) {
        throw new Error('Steer message is required.')
    }

    const imageItems = resolveCodexImageInputItems(input.attachments)
    const event: CodexRunEvent = {
        id: `codex_steer_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
        kind: 'steer',
        title: 'Steered conversation',
        content,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        createdAt: new Date().toISOString(),
    }
    activeRun.emitEvent(event)

    const response = await activeRun.client.request<{ turnId: string }>('turn/steer', {
        threadId: activeRun.threadId,
        expectedTurnId: activeRun.turnId,
        input: [{ type: 'text', text: content, text_elements: [] }, ...imageItems],
    })
    if (response && typeof response.turnId === 'string') {
        activeRun.turnId = response.turnId
    }

    return { ok: true as const, event }
}

export async function interruptActiveCodexRun(sessionId: string) {
    const activeRun = getActiveCodexRun(sessionId)
    if (!activeRun) {
        throw new Error('No active Codex turn is available.')
    }

    await activeRun.client.request('turn/interrupt', {
        threadId: activeRun.threadId,
        turnId: activeRun.turnId,
    })
    return { ok: true as const }
}

class CodexAppServerClient {
    private process: ChildProcessWithoutNullStreams
    private nextId = 1
    private pending = new Map<number, PendingRequest>()
    private buffer = ''
    private stderrBuffer = ''
    private notificationHandler: ((message: JsonRpcMessage) => void) | null = null
    private serverRequestHandler: ServerRequestHandler | null = null
    private exitHandler: ((error: Error) => void) | null = null
    private closed = false

    private constructor(process: ChildProcessWithoutNullStreams) {
        this.process = process
        this.process.stdout.setEncoding('utf8')
        this.process.stdout.on('data', (chunk: string) => {
            this.buffer += chunk
            this.flushBuffer()
        })
        this.process.stderr.setEncoding('utf8')
        this.process.stderr.on('data', (chunk: string) => {
            // Keep the tail of stderr so a startup failure (bad config.toml, codex
            // version mismatch, missing auth, panic) can be surfaced instead of swallowed.
            this.stderrBuffer = (this.stderrBuffer + chunk).slice(-8000)
        })
        this.process.on('error', (spawnError) => {
            if (this.closed) return
            const error = new Error(`Failed to start Codex app-server: ${spawnError.message}`)
            console.error('[codex app-server] spawn error:', spawnError)
            this.rejectAll(error)
            this.exitHandler?.(error)
        })
        this.process.on('exit', (code, signal) => {
            if (this.closed) return
            const stderrTail = this.stderrBuffer.trim()
            if (code !== 0) {
                console.error(
                    `[codex app-server] exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.` +
                        (stderrTail ? `\n${stderrTail}` : ' (no stderr output)')
                )
            }
            const baseMessage =
                code === 0
                    ? 'Codex app-server closed.'
                    : `Codex app-server exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`
            const detail = code !== 0 && stderrTail ? ` ${stderrTail.slice(-600)}` : ''
            const error = new Error(`${baseMessage}${detail}`)
            this.rejectAll(error)
            this.exitHandler?.(error)
        })
    }

    static async create(codexHome: string) {
        const child = spawn('codex', ['app-server'], {
            env: {
                ...globalThis.process.env,
                CODEX_HOME: codexHome,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            // On Windows `codex` is installed as a `.cmd`/`.ps1` shim that Node's direct
            // spawn cannot resolve (spawn codex ENOENT). Routing through the shell lets it
            // resolve the command the same way an interactive prompt does. macOS/Linux keep
            // the direct exec.
            shell: globalThis.process.platform === 'win32',
        })

        const client = new CodexAppServerClient(child)
        await client.request('initialize', {
            clientInfo: {
                name: 'OpenNovelWriter',
                version: '0.1.0',
            },
            capabilities: { experimentalApi: true },
        })
        return client
    }

    setNotificationHandler(handler: ((message: JsonRpcMessage) => void) | null) {
        this.notificationHandler = handler
    }

    setServerRequestHandler(handler: ServerRequestHandler | null) {
        this.serverRequestHandler = handler
    }

    setExitHandler(handler: ((error: Error) => void) | null) {
        this.exitHandler = handler
    }

    async request<T>(method: string, params: unknown): Promise<T> {
        if (this.closed) {
            throw new Error('Codex app-server client is closed.')
        }

        const id = this.nextId++
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params,
        })

        const response = new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
        })

        this.process.stdin.write(`${payload}\n`)
        return response
    }

    respond(id: number | string, result: unknown) {
        if (this.closed) return
        this.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
    }

    close() {
        if (this.closed) return
        this.closed = true
        this.rejectAll(new Error('Codex app-server client closed.'))
        this.process.kill('SIGTERM')
    }

    private flushBuffer() {
        let newlineIndex = this.buffer.indexOf('\n')
        while (newlineIndex >= 0) {
            const line = this.buffer.slice(0, newlineIndex).trim()
            this.buffer = this.buffer.slice(newlineIndex + 1)
            if (line) {
                this.handleMessage(JSON.parse(line) as JsonRpcMessage)
            }
            newlineIndex = this.buffer.indexOf('\n')
        }
    }

    private handleMessage(message: JsonRpcMessage) {
        if (typeof message.id === 'number' && this.pending.has(message.id)) {
            const pending = this.pending.get(message.id)
            this.pending.delete(message.id)
            if (!pending) return

            if (message.error) {
                pending.reject(new Error(message.error.message || 'Codex app-server request failed.'))
                return
            }

            pending.resolve(message.result)
            return
        }

        if (message.id !== undefined && message.method) {
            void this.handleServerRequest(message)
            return
        }

        if (message.method) {
            this.notificationHandler?.(message)
        }
    }

    private rejectAll(error: Error) {
        for (const pending of this.pending.values()) {
            pending.reject(error)
        }
        this.pending.clear()
    }

    private async handleServerRequest(message: JsonRpcMessage) {
        try {
            const response = this.serverRequestHandler
                ? await this.serverRequestHandler(message)
                : getDefaultServerRequestResponse(message.method ?? '')
            this.respond(message.id!, response)
            this.notificationHandler?.(message)
        } catch {
            const fallback = getDeclinedServerRequestResponse(message.method ?? '')
            this.respond(message.id!, fallback)
            this.notificationHandler?.(message)
        }
    }
}

type CodexRunEvent = {
    id: string
    kind: string
    title: string
    content: string
    /** Managed `/uploads/...` image URLs carried by this event (steer input, generated images). */
    attachments?: string[]
    createdAt: string
}

type CodexImageInputItem = { type: 'localImage'; path: string }

/** Managed upload URLs → Codex `localImage` input items (absolute disk paths). */
function resolveCodexImageInputItems(urls: string[] | null | undefined): CodexImageInputItem[] {
    if (!urls || urls.length === 0) return []
    const items: CodexImageInputItem[] = []
    for (const url of urls) {
        const filepath = resolveManagedUploadPath(url)
        if (filepath) items.push({ type: 'localImage', path: filepath })
    }
    return items
}

type CodexPlanStep = {
    step: string
    status: string
}

type CodexRunStreamHandlers = {
    onAssistantDelta?: (delta: string) => void
    onPlanDelta?: (event: { id: string; delta: string; createdAt: string }) => void
    onEvent?: (event: CodexRunEvent) => void
    onApprovalRequest?: (request: CodexApprovalRequest) => void
    onContextWindow?: (contextWindow: CodexContextWindow) => void
}

type CodexRuntimeReviewOptions = {
    approvalPolicy: 'on-request' | 'never'
    approvalsReviewer: 'user' | 'auto_review'
}

function getCodexRuntimeReviewOptions(reviewLevel: CodexReviewLevel): CodexRuntimeReviewOptions {
    if (reviewLevel === 'auto_review') {
        return {
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
        }
    }

    if (reviewLevel === 'no_review') {
        return {
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
        }
    }

    return {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
    }
}

function getCodexCollaborationMode(input: {
    planMode: boolean
    modelId: string
    reasoningEffort: string
}) {
    return {
        mode: input.planMode ? 'plan' : 'default',
        settings: {
            model: input.modelId,
            reasoning_effort: input.planMode ? CODEX_PLAN_MODE_REASONING_EFFORT : input.reasoningEffort,
            developer_instructions: null,
        },
    }
}

function getDefaultServerRequestResponse(method: string) {
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
        return { decision: 'decline' }
    }
    if (method === 'item/tool/call') {
        return { contentItems: [{ type: 'text', text: 'Tool call is not available in OpenNovelWriter yet.' }], success: false }
    }
    if (method === 'item/tool/requestUserInput') {
        return { answers: [] }
    }
    if (method === 'mcpServer/elicitation/request') {
        return { action: 'decline' }
    }
    if (method === 'item/permissions/requestApproval') {
        return {
            permissions: {},
            scope: 'turn',
        }
    }
    if (method === 'account/chatgptAuthTokens/refresh') {
        return { status: 'cancelled' }
    }
    return null
}

function getDeclinedServerRequestResponse(method: string) {
    if (method === 'mcpServer/elicitation/request') {
        return { action: 'decline', content: null, _meta: null }
    }
    return getDefaultServerRequestResponse(method)
}

function getAcceptedServerRequestResponse(method: string, params: Record<string, unknown>) {
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
        return { decision: 'accept' }
    }
    if (method === 'item/permissions/requestApproval') {
        return {
            permissions: params.permissions ?? {},
            scope: 'turn',
        }
    }
    if (method === 'mcpServer/elicitation/request') {
        return { action: 'accept', content: {}, _meta: null }
    }
    return getDefaultServerRequestResponse(method)
}

function isApprovalServerRequest(method: string) {
    return (
        method === 'item/commandExecution/requestApproval' ||
        method === 'item/fileChange/requestApproval' ||
        method === 'item/permissions/requestApproval' ||
        method === 'mcpServer/elicitation/request'
    )
}

function getApprovalServerRequestResponse(input: {
    method: string
    params: Record<string, unknown>
    request: CodexApprovalRequest
    decision: CodexApprovalDecision
}) {
    const decision = input.decision.decision === 'steer' ? 'decline' : input.decision.decision

    if (input.method === 'item/commandExecution/requestApproval') {
        if (decision === 'acceptWithPolicy' && input.request.proposedPolicy?.length) {
            return {
                decision: {
                    acceptWithExecpolicyAmendment: {
                        execpolicy_amendment: input.request.proposedPolicy,
                    },
                },
            }
        }
        if (decision === 'acceptForSession') return { decision: 'acceptForSession' }
        if (decision === 'accept') return { decision: 'accept' }
        if (decision === 'cancel') return { decision: 'cancel' }
        return { decision: 'decline' }
    }

    if (input.method === 'item/fileChange/requestApproval') {
        if (decision === 'acceptForSession' || decision === 'acceptWithPolicy') return { decision: 'acceptForSession' }
        if (decision === 'accept') return { decision: 'accept' }
        if (decision === 'cancel') return { decision: 'cancel' }
        return { decision: 'decline' }
    }

    if (input.method === 'item/permissions/requestApproval') {
        if (decision === 'accept' || decision === 'acceptForSession' || decision === 'acceptWithPolicy') {
            return {
                permissions: input.params.permissions ?? {},
                scope: decision === 'accept' ? 'turn' : 'session',
            }
        }
        return { permissions: {}, scope: 'turn' }
    }

    if (input.method === 'mcpServer/elicitation/request') {
        if (decision === 'accept' || decision === 'acceptForSession' || decision === 'acceptWithPolicy') {
            return { action: 'accept', content: {}, _meta: null }
        }
        if (decision === 'cancel') return { action: 'cancel', content: null, _meta: null }
        return { action: 'decline', content: null, _meta: null }
    }

    return getDeclinedServerRequestResponse(input.method)
}

function getMessageTextFromThreadItem(item: unknown) {
    if (!item || typeof item !== 'object') return ''
    const record = item as Record<string, unknown>
    if (record.type !== 'agentMessage') return ''
    return typeof record.text === 'string' ? record.text : ''
}

function getWebSearchEventContent(action: Record<string, unknown>, fallbackQuery: string) {
    const actionType = typeof action.type === 'string' ? action.type : ''
    if (actionType === 'search') {
        const actionQuery = typeof action.query === 'string' ? action.query : fallbackQuery
        const queries = Array.isArray(action.queries)
            ? action.queries.filter((query): query is string => typeof query === 'string' && query.trim().length > 0)
            : []
        return {
            title: actionQuery ? `Searching web: ${actionQuery}` : 'Searching web',
            content: queries.length ? queries.map((query) => `- ${query}`).join('\n') : actionQuery,
        }
    }

    if (actionType === 'openPage') {
        const url = typeof action.url === 'string' ? action.url : ''
        return {
            title: url ? `Opening page: ${url}` : 'Opening page',
            content: url,
        }
    }

    if (actionType === 'findInPage') {
        const url = typeof action.url === 'string' ? action.url : ''
        const pattern = typeof action.pattern === 'string' ? action.pattern : ''
        return {
            title: pattern ? `Finding in page: ${pattern}` : 'Finding in page',
            content: [url, pattern ? `pattern: ${pattern}` : ''].filter(Boolean).join('\n'),
        }
    }

    return {
        title: fallbackQuery ? `Searching web: ${fallbackQuery}` : 'Searching web',
        content: fallbackQuery,
    }
}

function getEventFromThreadItem(item: unknown): CodexRunEvent | null {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    const now = new Date().toISOString()
    const id = typeof record.id === 'string' ? record.id : `codex_event_${now}_${Math.random().toString(16).slice(2)}`

    if (type === 'commandExecution') {
        return {
            id,
            kind: 'command',
            title: typeof record.command === 'string' ? record.command : 'Command',
            content: typeof record.aggregatedOutput === 'string' ? record.aggregatedOutput : '',
            createdAt: now,
        }
    }

    if (type === 'mcpToolCall') {
        const server = typeof record.server === 'string' ? record.server : 'mcp'
        const tool = typeof record.tool === 'string' ? record.tool : 'tool'
        return {
            id,
            kind: 'tool',
            title: `${server}.${tool}`,
            content: JSON.stringify(record.result ?? record.error ?? record.arguments ?? null, null, 2),
            createdAt: now,
        }
    }

    if (type === 'fileChange') {
        return {
            id,
            kind: 'file',
            title: 'File change',
            content: JSON.stringify(record.changes ?? [], null, 2),
            createdAt: now,
        }
    }

    if (type === 'webSearch') {
        const fallbackQuery = typeof record.query === 'string' ? record.query : ''
        const action = record.action && typeof record.action === 'object'
            ? record.action as Record<string, unknown>
            : {}
        const eventContent = getWebSearchEventContent(action, fallbackQuery)
        return {
            id,
            kind: 'web_search',
            title: eventContent.title,
            content: eventContent.content,
            createdAt: now,
        }
    }

    if (type === 'plan') {
        return {
            id,
            kind: 'plan',
            title: 'Proposed Plan',
            content: typeof record.text === 'string' ? record.text : '',
            createdAt: now,
        }
    }

    if (type === 'imageGeneration') {
        const revisedPrompt = typeof record.revisedPrompt === 'string' ? record.revisedPrompt : ''
        const status = typeof record.status === 'string' ? record.status : ''
        return {
            id,
            kind: 'image_generation',
            title: 'Image generation',
            content: revisedPrompt || status,
            createdAt: now,
        }
    }

    if (type === 'imageView') {
        return {
            id,
            kind: 'image_view',
            title: 'Viewed image',
            content: typeof record.path === 'string' ? record.path : '',
            createdAt: now,
        }
    }

    return null
}

/**
 * A context-compaction thread item (`item.type === 'contextCompaction'`) marks Codex summarizing
 * its own history — emitted automatically when usage crosses `model_auto_compact_token_limit`, or
 * on demand via `thread/compact/start`. It has no rich payload, so we surface it as a lightweight
 * `context_compaction` event whose running/done state comes from the item/started vs item/completed
 * method rather than any field on the item.
 */
function getContextCompactionItemId(item: unknown): string | null {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    if (record.type !== 'contextCompaction') return null
    return typeof record.id === 'string' ? record.id : null
}

function getThreadItemId(item: unknown) {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    return typeof record.id === 'string' ? record.id : null
}

function getThreadItemCommand(item: unknown) {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    return typeof record.command === 'string' ? record.command : null
}

function getEventFromPlanUpdate(params: Record<string, unknown>): CodexRunEvent {
    const plan = Array.isArray(params.plan)
        ? params.plan
            .map((item): CodexPlanStep | null => {
                if (!item || typeof item !== 'object') return null
                const record = item as Record<string, unknown>
                if (typeof record.step !== 'string' || typeof record.status !== 'string') return null
                return { step: record.step, status: record.status }
            })
            .filter((item): item is CodexPlanStep => item !== null)
        : []
    const now = new Date().toISOString()

    return {
        id: `codex_plan_update_${now}_${Math.random().toString(16).slice(2)}`,
        kind: 'plan_update',
        title: 'Updated Plan',
        content: JSON.stringify(
            {
                explanation: typeof params.explanation === 'string' ? params.explanation : null,
                plan,
            },
            null,
            2
        ),
        createdAt: now,
    }
}

function getNumberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getTokenUsage(value: unknown) {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const inputTokens = getNumberValue(record.input_tokens)
    const cachedInputTokens = getNumberValue(record.cached_input_tokens)
    const outputTokens = getNumberValue(record.output_tokens)
    const reasoningOutputTokens = getNumberValue(record.reasoning_output_tokens)
    const totalTokens = getNumberValue(record.total_tokens)
    if (
        inputTokens === null ||
        cachedInputTokens === null ||
        outputTokens === null ||
        reasoningOutputTokens === null ||
        totalTokens === null
    ) {
        return null
    }
    return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens }
}

function getContextWindowFromTokenCountPayload(payload: Record<string, unknown>): CodexContextWindow | null {
    if (payload.type !== 'token_count') return null
    const info = payload.info && typeof payload.info === 'object'
        ? payload.info as Record<string, unknown>
        : null
    if (!info) return null

    const totalTokens = getNumberValue(info.model_context_window)
    const lastTokenUsage = getTokenUsage(info.last_token_usage)
    if (totalTokens === null || !lastTokenUsage) return null

    const usedTokens = lastTokenUsage.totalTokens
    const remainingTokens = Math.max(0, totalTokens - usedTokens)
    const usagePercent = totalTokens > 0 ? Math.min(100, Math.max(0, usedTokens / totalTokens * 100)) : 0

    return {
        usedTokens,
        totalTokens,
        usagePercent,
        remainingTokens,
        lastTokenUsage,
        totalTokenUsage: getTokenUsage(info.total_token_usage),
    }
}

function getContextWindowFromTokenCount(value: unknown, depth = 0): CodexContextWindow | null {
    if (!value || typeof value !== 'object' || depth > 4) return null
    const record = value as Record<string, unknown>
    const direct = getContextWindowFromTokenCountPayload(record)
    if (direct) return direct

    for (const key of ['payload', 'event', 'item', 'message', 'msg', 'data']) {
        const nested = getContextWindowFromTokenCount(record[key], depth + 1)
        if (nested) return nested
    }

    return null
}

async function findCodexRolloutFiles(root: string, threadId: string, depth = 0): Promise<string[]> {
    if (depth > 5) return []

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
        entries = await fs.readdir(root, { withFileTypes: true, encoding: 'utf8' }) as typeof entries
    } catch {
        return []
    }

    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(root, entry.name)
        if (entry.isDirectory()) return findCodexRolloutFiles(entryPath, threadId, depth + 1)
        if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(threadId)) return [entryPath]
        return []
    }))

    return files.flat()
}

async function readLatestContextWindowFromSessionLog(codexHome: string, threadId: string) {
    const rolloutFiles = await findCodexRolloutFiles(path.join(codexHome, 'sessions'), threadId)
    if (!rolloutFiles.length) return null

    const fileStats = await Promise.all(rolloutFiles.map(async (filePath) => {
        try {
            return { filePath, mtimeMs: (await fs.stat(filePath)).mtimeMs }
        } catch {
            return null
        }
    }))
    const latestFile = fileStats
        .filter((item): item is { filePath: string; mtimeMs: number } => item !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath
    if (!latestFile) return null

    const content = await fs.readFile(latestFile, 'utf8')
    let contextWindow: CodexContextWindow | null = null
    for (const rawLine of content.split(/\r?\n/u)) {
        const line = rawLine.trim()
        if (!line) continue
        try {
            const nextContextWindow = getContextWindowFromTokenCount(JSON.parse(line) as unknown)
            if (nextContextWindow) contextWindow = nextContextWindow
        } catch {
            continue
        }
    }

    return contextWindow
}

function extractMcpResultText(result: unknown): string | null {
    if (!result || typeof result !== 'object') return null
    const content = (result as Record<string, unknown>).content
    if (!Array.isArray(content)) return null
    for (const part of content) {
        if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
            return (part as Record<string, unknown>).text as string
        }
    }
    return null
}

// Pull the SceneEdit ids out of a completed `edit_scene_content` tool result so we can
// associate them with the session that produced them.
function extractSceneEditIdsFromItem(item: unknown): string[] {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (record.type !== 'mcpToolCall' || record.tool !== 'edit_scene_content') return []
    const text = extractMcpResultText(record.result)
    if (!text) return []
    try {
        const payload = JSON.parse(text) as { applied?: { id?: unknown }[] }
        return (payload.applied ?? [])
            .map((entry) => (typeof entry?.id === 'string' ? entry.id : null))
            .filter((id): id is string => id !== null)
    } catch {
        return []
    }
}

async function tagSceneEditsWithSession(item: unknown, sessionId: string) {
    const ids = extractSceneEditIdsFromItem(item)
    if (ids.length === 0) return
    try {
        await prisma.sceneEdit.updateMany({
            where: { id: { in: ids }, sessionId: null },
            data: { sessionId },
        })
    } catch {
        // Tagging is best-effort; the edits still appear in the manuscript review UI.
    }
}

type CodexSkillInputItem = { type: 'skill'; name: string; path: string }

async function resolveCodexCoreSkillsRoot(): Promise<string | null> {
    const relativePath = path.join('src', 'lib', 'server', 'codex-core', 'skills')
    const candidates = [
        path.join(process.cwd(), relativePath),
        path.join(process.cwd(), 'web', relativePath),
    ]
    for (const candidate of candidates) {
        try {
            await fs.access(candidate)
            return candidate
        } catch {
            // Try the next candidate.
        }
    }
    return null
}

/**
 * Mount the app's built-in skills (codex-core/skills/<name>/SKILL.md) as a standalone skills
 * root for this app-server process. Codex then injects each skill's name + description into
 * the thread context and reads the full SKILL.md on demand (progressive disclosure).
 * Best-effort: a codex binary without skills/extraRoots/set must not break the turn.
 */
async function mountCodexCoreSkills(client: CodexAppServerClient) {
    const root = await resolveCodexCoreSkillsRoot()
    if (!root) return
    try {
        await client.request('skills/extraRoots/set', { extraRoots: [root] })
    } catch (error) {
        console.warn('Failed to mount codex-core skills:', error)
    }
}

/**
 * Resolve `{ id, name }` skill references into Codex `skill` input items. The canonical absolute
 * path is taken from `skills/list` (matched by the `/skills/<id>` segment of the synced symlink);
 * if the skill is not reported there we fall back to the expected `SKILL.md` path. Attaching the
 * item lets the server inject the full skill instructions without re-resolving the `$name` mention.
 */
async function resolveCodexSkillInputItems(
    client: CodexAppServerClient,
    codexHome: string,
    refs: Array<{ id: string; name: string }> | null | undefined
): Promise<CodexSkillInputItem[]> {
    if (!refs || refs.length === 0) return []

    let metadata: Array<{ name: string; path: string }> = []
    try {
        const response = await client.request<{ data?: Array<{ skills?: Array<{ name?: string; path?: string }> }> }>(
            'skills/list',
            { forceReload: false }
        )
        metadata = (response?.data ?? [])
            .flatMap((entry) => entry.skills ?? [])
            .map((skill) => ({ name: String(skill.name ?? ''), path: String(skill.path ?? '') }))
            .filter((skill) => skill.path)
    } catch {
        metadata = []
    }

    const items: CodexSkillInputItem[] = []
    const seen = new Set<string>()
    for (const ref of refs) {
        const idMarker = `/skills/${ref.id}`
        const match = metadata.find((skill) => skill.path.replaceAll(path.sep, '/').includes(idMarker))
        const resolved = match ?? { name: ref.name, path: path.join(codexHome, 'skills', ref.id, 'SKILL.md') }
        if (seen.has(resolved.path)) continue
        seen.add(resolved.path)
        items.push({ type: 'skill', name: resolved.name || ref.name, path: resolved.path })
    }
    return items
}

export async function runNovelCodexTurn(input: {
    sessionId: string
    ownerId: string
    novelId: string
    codexThreadId?: string | null
    codexConnectionId?: string | null
    reviewLevel?: string | null
    modelId?: string | null
    reasoningEffort?: string | null
    serviceTier?: string | null
    planMode?: boolean | null
    prompt: string
    imageUrls?: string[] | null
    skillRefs?: Array<{ id: string; name: string }> | null
    stream?: CodexRunStreamHandlers
}) {
    const [sessionWorkspacePath, connection] = await Promise.all([
        ensureCodexSessionWorkspace({
            ownerId: input.ownerId,
            novelId: input.novelId,
            sessionId: input.sessionId,
        }),
        input.codexConnectionId
            ? prisma.codexConnection.findFirst({
                where: { id: input.codexConnectionId, ownerId: input.ownerId },
            })
            : prisma.codexConnection.findFirst({
                where: { ownerId: input.ownerId, isActive: true },
                orderBy: { createdAt: 'asc' },
            }),
    ])

    if (!connection) {
        throw new Error('No Codex connection is available.')
    }

    const codexHome = connection.providerType === 'custom'
        ? await syncCodexConnectionRuntimeFiles(connection)
        : await ensureCodexConnectionHome(input.ownerId, connection.id)
    const reviewLevel = normalizeCodexReviewLevel(input.reviewLevel) ?? DEFAULT_CODEX_REVIEW_LEVEL
    const reviewOptions = getCodexRuntimeReviewOptions(reviewLevel)
    // Rewrite the managed MCP config block before spawning the app-server so config.toml
    // (read at process startup) always reflects the current code. Under manual review our
    // first-party tools prompt the human; under auto/no review they pre-approve so calls are
    // not routed to the review subagent (which can 503 and block the tool).
    await syncCodexConnectionMcp({
        ownerId: input.ownerId,
        connectionId: connection.id,
        toolsApprovalMode: reviewLevel === 'user_review' ? 'prompt' : 'approve',
        reviewLevel,
    })
    const client = await CodexAppServerClient.create(codexHome)
    await mountCodexCoreSkills(client)
    const modelId = typeof input.modelId === 'string' && input.modelId.trim()
        ? input.modelId.trim()
        : connection.defaultModelId?.trim() || DEFAULT_CODEX_MODEL
    const reasoningEffort =
        normalizeCodexReasoningEffort(input.reasoningEffort) ?? DEFAULT_CODEX_REASONING_EFFORT
    const requestedServiceTier = normalizeCodexServiceTier(input.serviceTier) ?? DEFAULT_CODEX_SERVICE_TIER
    const serviceTier =
        requestedServiceTier === 'fast' &&
        connection.providerType === 'openai-official' &&
        connection.authStatus === 'authenticated'
            ? 'fast'
            : null
    const collaborationMode = getCodexCollaborationMode({
        planMode: input.planMode === true,
        modelId,
        reasoningEffort,
    })
    let assistantText = ''
    let contextWindow: CodexContextWindow | null = null
    let activeRunHandle: ActiveCodexRunHandle | null = null
    const eventOrder: string[] = []
    const eventsById = new Map<string, CodexRunEvent>()
    const commandTitlesById = new Map<string, string>()
    const commandOutputsById = new Map<string, string>()
    const eventCreatedAtById = new Map<string, string>()

    const emitEvent = (event: CodexRunEvent) => {
        if (!eventsById.has(event.id)) {
            eventOrder.push(event.id)
        }
        eventsById.set(event.id, event)
        input.stream?.onEvent?.(event)
    }

    const rememberThreadItem = (item: unknown) => {
        const itemId = getThreadItemId(item)
        if (!itemId) return
        const command = getThreadItemCommand(item)
        if (command) commandTitlesById.set(itemId, command)
        if (!eventCreatedAtById.has(itemId)) {
            eventCreatedAtById.set(itemId, new Date().toISOString())
        }
    }

    // Codex saves generated images (gpt-image) into the session workspace; copy each into
    // managed uploads and re-emit its event with the URL so it renders and survives as long
    // as the session does. Imports are awaited before the turn result is returned.
    const pendingImageImports: Array<Promise<void>> = []
    const importGeneratedImage = (item: unknown) => {
        if (!item || typeof item !== 'object') return
        const record = item as Record<string, unknown>
        if (record.type !== 'imageGeneration') return
        const itemId = getThreadItemId(item)
        const savedPath = typeof record.savedPath === 'string' && record.savedPath ? record.savedPath : null
        if (!itemId || !savedPath) return

        pendingImageImports.push(
            (async () => {
                try {
                    const buffer = await fs.readFile(savedPath)
                    const ext = path.extname(savedPath).replace('.', '') || 'png'
                    const saved = await saveImageBuffer(buffer, ext)
                    const existing = eventsById.get(itemId)
                    emitEvent({
                        id: itemId,
                        kind: 'image_generation',
                        title: existing?.title ?? 'Image generation',
                        content: existing?.content ?? '',
                        attachments: [saved.url],
                        createdAt: existing?.createdAt ?? eventCreatedAtById.get(itemId) ?? new Date().toISOString(),
                    })
                } catch (error) {
                    console.error('Failed to import Codex generated image:', error)
                }
            })()
        )
    }

    try {
        const threadResponse = input.codexThreadId
            ? await client.request<{ thread: { id: string } }>('thread/resume', {
                threadId: input.codexThreadId,
                model: modelId,
                serviceTier,
                cwd: sessionWorkspacePath,
                approvalPolicy: reviewOptions.approvalPolicy,
                approvalsReviewer: reviewOptions.approvalsReviewer,
                sandbox: 'workspace-write',
                excludeTurns: true,
            })
            : await client.request<{ thread: { id: string } }>('thread/start', {
                model: modelId,
                serviceTier,
                cwd: sessionWorkspacePath,
                approvalPolicy: reviewOptions.approvalPolicy,
                approvalsReviewer: reviewOptions.approvalsReviewer,
                sandbox: 'workspace-write',
                sessionStartSource: 'startup',
            })

        const threadId = threadResponse.thread.id
        const skillInputItems = await resolveCodexSkillInputItems(client, codexHome, input.skillRefs)
        const turnResponse = await client.request<{ turn: { id: string } }>('turn/start', {
            threadId,
            cwd: sessionWorkspacePath,
            model: modelId,
            serviceTier,
            effort: reasoningEffort,
            collaborationMode,
            approvalPolicy: reviewOptions.approvalPolicy,
            approvalsReviewer: reviewOptions.approvalsReviewer,
            input: [
                { type: 'text', text: input.prompt, text_elements: [] },
                ...resolveCodexImageInputItems(input.imageUrls),
                ...skillInputItems,
            ],
        })
        let turnId = turnResponse.turn.id
        activeRunHandle = {
            sessionId: input.sessionId,
            client,
            threadId,
            get turnId() {
                return turnId
            },
            set turnId(value: string) {
                turnId = value
            },
            emitEvent: (event) => {
                input.stream?.onEvent?.(event)
            },
        }
        registerActiveCodexRun(activeRunHandle)

        client.setServerRequestHandler(async (message) => {
            const method = typeof message.method === 'string' ? message.method : ''
            const params = message.params && typeof message.params === 'object'
                ? message.params as Record<string, unknown>
                : {}
            if (!isApprovalServerRequest(method) || message.id === undefined) {
                return getDefaultServerRequestResponse(method)
            }
            // no_review auto-accepts everything. Under auto_review the review subagent owns
            // command/file approvals, so we pre-accept those here — but MCP elicitations we raise
            // for destructive actions (e.g. delete_snippet) must always reach the author, so let
            // them fall through to the user prompt.
            if (reviewOptions.approvalPolicy === 'never') {
                return getAcceptedServerRequestResponse(method, params)
            }
            if (reviewOptions.approvalsReviewer !== 'user' && method !== 'mcpServer/elicitation/request') {
                return getAcceptedServerRequestResponse(method, params)
            }

            const approvalRequest = createCodexApprovalRequest({
                sessionId: input.sessionId,
                requestId: String(message.id),
                method,
                params,
            })
            if (isCodexApprovalRemembered(approvalRequest)) {
                return getAcceptedServerRequestResponse(method, params)
            }

            input.stream?.onApprovalRequest?.(approvalRequest)
            const decision = await waitForCodexApprovalDecision(approvalRequest)
            if (decision.decision === 'acceptForSession') {
                rememberCodexApprovalForSession(approvalRequest)
            }
            if (decision.decision === 'steer' && decision.message?.trim()) {
                input.stream?.onEvent?.({
                    id: `codex_steer_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
                    kind: 'steer',
                    title: 'Steered conversation',
                    content: decision.message.trim(),
                    createdAt: new Date().toISOString(),
                })
                setTimeout(() => {
                    void client.request('turn/steer', {
                        threadId,
                        expectedTurnId: turnId,
                        input: [{ type: 'text', text: decision.message!.trim(), text_elements: [] }],
                    }).then((response) => {
                        if (response && typeof response === 'object' && typeof (response as { turnId?: unknown }).turnId === 'string') {
                            turnId = (response as { turnId: string }).turnId
                            const currentActiveRunHandle = activeRunHandle
                            if (currentActiveRunHandle) {
                                currentActiveRunHandle.turnId = turnId
                            }
                        }
                    }).catch((error) => {
                        console.error('Failed to steer Codex turn after approval response:', error)
                    })
                }, 0)
            }
            return getApprovalServerRequestResponse({
                method,
                params,
                request: approvalRequest,
                decision,
            })
        })

        await new Promise<void>((resolve, reject) => {
            client.setNotificationHandler((message) => {
                const params = message.params as Record<string, unknown> | undefined
                if (!params) return
                if (params.threadId && params.threadId !== threadId) return
                const nextContextWindow = getContextWindowFromTokenCount(params)
                if (nextContextWindow) {
                    contextWindow = nextContextWindow
                    input.stream?.onContextWindow?.(nextContextWindow)
                    return
                }
                if (params.threadId !== threadId) return

                if (message.method === 'item/agentMessage/delta' && params.turnId === turnId) {
                    if (typeof params.delta === 'string') {
                        assistantText += params.delta
                        input.stream?.onAssistantDelta?.(params.delta)
                    }
                    return
                }

                if (message.method === 'item/plan/delta' && params.turnId === turnId) {
                    if (typeof params.itemId === 'string' && typeof params.delta === 'string') {
                        input.stream?.onPlanDelta?.({
                            id: params.itemId,
                            delta: params.delta,
                            createdAt: new Date().toISOString(),
                        })
                    }
                    return
                }

                if (message.method === 'turn/plan/updated' && params.turnId === turnId) {
                    const event = getEventFromPlanUpdate(params)
                    emitEvent(event)
                    return
                }

                if (message.method === 'item/started' && params.turnId === turnId) {
                    const item = params.item
                    const compactionId = getContextCompactionItemId(item)
                    if (compactionId) {
                        const createdAt = eventCreatedAtById.get(compactionId) ?? new Date().toISOString()
                        eventCreatedAtById.set(compactionId, createdAt)
                        emitEvent({ id: compactionId, kind: 'context_compaction', title: '', content: 'running', createdAt })
                        return
                    }
                    rememberThreadItem(item)
                    const event = getEventFromThreadItem(item)
                    if (event) {
                        eventCreatedAtById.set(event.id, event.createdAt)
                        if (event.kind === 'command') {
                            commandTitlesById.set(event.id, event.title)
                            commandOutputsById.set(event.id, event.content)
                        }
                        emitEvent(event)
                    }
                    return
                }

                if (message.method === 'item/commandExecution/outputDelta' && params.turnId === turnId) {
                    const itemId = typeof params.itemId === 'string' ? params.itemId : null
                    const delta = typeof params.delta === 'string' ? params.delta : ''
                    if (!itemId || !delta) return

                    const content = `${commandOutputsById.get(itemId) ?? ''}${delta}`
                    commandOutputsById.set(itemId, content)
                    emitEvent({
                        id: itemId,
                        kind: 'command',
                        title: commandTitlesById.get(itemId) ?? 'Command',
                        content,
                        createdAt: eventCreatedAtById.get(itemId) ?? new Date().toISOString(),
                    })
                    return
                }

                if (message.method === 'item/completed' && params.turnId === turnId) {
                    const item = params.item
                    const compactionId = getContextCompactionItemId(item)
                    if (compactionId) {
                        const createdAt = eventCreatedAtById.get(compactionId) ?? new Date().toISOString()
                        eventCreatedAtById.set(compactionId, createdAt)
                        emitEvent({ id: compactionId, kind: 'context_compaction', title: '', content: 'done', createdAt })
                        return
                    }
                    rememberThreadItem(item)
                    void tagSceneEditsWithSession(item, input.sessionId)
                    importGeneratedImage(item)
                    const event = getEventFromThreadItem(item)
                    if (event) {
                        if (event.kind === 'command') {
                            commandTitlesById.set(event.id, event.title)
                            commandOutputsById.set(event.id, event.content)
                            event.createdAt = eventCreatedAtById.get(event.id) ?? event.createdAt
                        } else if (eventCreatedAtById.has(event.id)) {
                            event.createdAt = eventCreatedAtById.get(event.id) ?? event.createdAt
                        } else {
                            eventCreatedAtById.set(event.id, event.createdAt)
                        }
                        emitEvent(event)
                    }

                    if (!assistantText) {
                        assistantText += getMessageTextFromThreadItem(item)
                    }
                    return
                }

                if (message.method === 'turn/completed') {
                    const turn = params.turn as Record<string, unknown> | undefined
                    if (turn?.id !== turnId) return
                    const status = (turn.status as Record<string, unknown> | undefined)?.type
                    if (status === 'failed') {
                        const error = turn.error as Record<string, unknown> | undefined
                        reject(new Error(typeof error?.message === 'string' ? error.message : 'Codex turn failed.'))
                    } else {
                        resolve()
                    }
                }
            })

            client.setExitHandler((error) => {
                if (activeRunHandle) clearActiveCodexRun(input.sessionId, activeRunHandle)
                reject(error)
            })
        })

        if (pendingImageImports.length > 0) {
            await Promise.allSettled(pendingImageImports)
        }

        if (!contextWindow) {
            contextWindow = await readLatestContextWindowFromSessionLog(codexHome, threadId)
            if (contextWindow) input.stream?.onContextWindow?.(contextWindow)
        }

        return {
            threadId,
            assistantText: assistantText.trim(),
            events: eventOrder.map((eventId) => eventsById.get(eventId)).filter((event): event is CodexRunEvent => event !== undefined),
            contextWindow,
            connectionId: connection.id,
        }
    } finally {
        if (activeRunHandle) clearActiveCodexRun(input.sessionId, activeRunHandle)
        client.close()
    }
}

/**
 * Manually compact a session's Codex thread via `thread/compact/start` (the on-demand counterpart
 * to the automatic compaction that fires at `model_auto_compact_token_limit`). Progress streams as
 * standard `turn/*` + `item/*` notifications, so we run it as a lightweight turn: register an active
 * run so the user can interrupt it, surface the `contextCompaction` divider, and — mirroring the
 * official app — always land on the "done" state even when interrupted mid-compaction.
 */
export async function runNovelCodexCompaction(input: {
    sessionId: string
    ownerId: string
    novelId: string
    codexThreadId?: string | null
    codexConnectionId?: string | null
    reviewLevel?: string | null
    modelId?: string | null
    serviceTier?: string | null
    stream?: CodexRunStreamHandlers
}) {
    if (!input.codexThreadId) {
        throw new Error('This session has no Codex thread to compact yet.')
    }

    const [sessionWorkspacePath, connection] = await Promise.all([
        ensureCodexSessionWorkspace({
            ownerId: input.ownerId,
            novelId: input.novelId,
            sessionId: input.sessionId,
        }),
        input.codexConnectionId
            ? prisma.codexConnection.findFirst({
                where: { id: input.codexConnectionId, ownerId: input.ownerId },
            })
            : prisma.codexConnection.findFirst({
                where: { ownerId: input.ownerId, isActive: true },
                orderBy: { createdAt: 'asc' },
            }),
    ])

    if (!connection) {
        throw new Error('No Codex connection is available.')
    }

    const codexHome = connection.providerType === 'custom'
        ? await syncCodexConnectionRuntimeFiles(connection)
        : await ensureCodexConnectionHome(input.ownerId, connection.id)
    const reviewLevel = normalizeCodexReviewLevel(input.reviewLevel) ?? DEFAULT_CODEX_REVIEW_LEVEL
    const reviewOptions = getCodexRuntimeReviewOptions(reviewLevel)
    const client = await CodexAppServerClient.create(codexHome)
    const modelId = typeof input.modelId === 'string' && input.modelId.trim()
        ? input.modelId.trim()
        : DEFAULT_CODEX_MODEL
    const requestedServiceTier = normalizeCodexServiceTier(input.serviceTier) ?? DEFAULT_CODEX_SERVICE_TIER
    const serviceTier =
        requestedServiceTier === 'fast' &&
        connection.providerType === 'openai-official' &&
        connection.authStatus === 'authenticated'
            ? 'fast'
            : null

    let contextWindow: CodexContextWindow | null = null
    let activeRunHandle: ActiveCodexRunHandle | null = null

    try {
        const threadResponse = await client.request<{ thread: { id: string } }>('thread/resume', {
            threadId: input.codexThreadId,
            model: modelId,
            serviceTier,
            cwd: sessionWorkspacePath,
            approvalPolicy: reviewOptions.approvalPolicy,
            approvalsReviewer: reviewOptions.approvalsReviewer,
            sandbox: 'workspace-write',
            excludeTurns: true,
        })
        const threadId = threadResponse.thread.id

        let turnId: string | null = null
        activeRunHandle = {
            sessionId: input.sessionId,
            client,
            threadId,
            get turnId() {
                return turnId ?? ''
            },
            set turnId(value: string) {
                turnId = value
            },
            emitEvent: (event) => {
                input.stream?.onEvent?.(event)
            },
        }
        registerActiveCodexRun(activeRunHandle)

        let compactionItemId: string | null = null
        let compactionDone = false
        const emitCompaction = (id: string, status: 'running' | 'done') => {
            compactionItemId = id
            if (status === 'done') compactionDone = true
            input.stream?.onEvent?.({
                id,
                kind: 'context_compaction',
                title: '',
                content: status,
                createdAt: new Date().toISOString(),
            })
        }

        // thread/compact/start returns {} immediately; the work streams as turn/* + item/* below.
        await client.request('thread/compact/start', { threadId })

        await new Promise<void>((resolve, reject) => {
            let settled = false
            const finish = () => {
                if (settled) return
                settled = true
                // Always settle on a visible "compacted" divider — even an interrupted compaction
                // shows "Context compacted" in the official app, so we match that.
                if (compactionItemId && !compactionDone) emitCompaction(compactionItemId, 'done')
                else if (!compactionItemId) emitCompaction(`codex_compaction_${threadId}`, 'done')
                resolve()
            }

            client.setNotificationHandler((message) => {
                const params = message.params as Record<string, unknown> | undefined
                if (!params) return
                if (params.threadId && params.threadId !== threadId) return

                if (typeof params.turnId === 'string' && !turnId) {
                    turnId = params.turnId
                }

                const nextContextWindow = getContextWindowFromTokenCount(params)
                if (nextContextWindow) {
                    contextWindow = nextContextWindow
                    input.stream?.onContextWindow?.(nextContextWindow)
                    return
                }

                if (message.method === 'turn/started') {
                    const turn = params.turn as Record<string, unknown> | undefined
                    if (typeof turn?.id === 'string') turnId = turn.id
                    return
                }

                if (message.method === 'item/started') {
                    const id = getContextCompactionItemId(params.item)
                    if (id) emitCompaction(id, 'running')
                    return
                }

                if (message.method === 'item/completed') {
                    const id = getContextCompactionItemId(params.item)
                    if (id) {
                        emitCompaction(id, 'done')
                        // The compaction item completing is the definitive done-signal; resolve on it
                        // in case the server doesn't follow with a separate turn/completed.
                        finish()
                    }
                    return
                }

                if (message.method === 'turn/completed') {
                    const turn = params.turn as Record<string, unknown> | undefined
                    if (turnId && turn?.id !== turnId) return
                    finish()
                }
            })

            client.setExitHandler((error) => {
                if (activeRunHandle) clearActiveCodexRun(input.sessionId, activeRunHandle)
                reject(error)
            })
        })

        if (!contextWindow) {
            contextWindow = await readLatestContextWindowFromSessionLog(codexHome, threadId)
            if (contextWindow) input.stream?.onContextWindow?.(contextWindow)
        }

        return {
            threadId,
            contextWindow,
            connectionId: connection.id,
        }
    } finally {
        if (activeRunHandle) clearActiveCodexRun(input.sessionId, activeRunHandle)
        client.close()
    }
}

export async function readCodexAccountInfo(codexHome: string): Promise<CodexAccountInfo> {
    const client = await CodexAppServerClient.create(codexHome)

    try {
        const response = await client.request<{
            account?: { type?: string; email?: string; planType?: string } | null
            requiresOpenaiAuth?: boolean
        }>('account/read', {})

        if (!response?.account) {
            return {
                status: 'unauthenticated',
                authType: null,
                accountEmail: null,
                accountPlan: null,
                lastAuthError: null,
            }
        }

        return {
            status: 'authenticated',
            authType: response.account.type || 'unknown',
            accountEmail: response.account.email ?? null,
            accountPlan: response.account.planType ?? null,
            lastAuthError: null,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read Codex account.'
        if (
            message.includes('email and plan type are required') ||
            message.includes('No such file or directory')
        ) {
            return {
                status: 'unauthenticated',
                authType: null,
                accountEmail: null,
                accountPlan: null,
                lastAuthError: null,
            }
        }

        return {
            status: 'error',
            authType: null,
            accountEmail: null,
            accountPlan: null,
            lastAuthError: message,
        }
    } finally {
        client.close()
    }
}

export async function syncCodexConnectionAuthState(input: {
    connectionId: string
    ownerId: string
    codexHome: string
}) {
    const accountInfo = await readCodexAccountInfo(input.codexHome)

    const authStatus =
        accountInfo.status === 'authenticated'
            ? 'authenticated'
            : accountInfo.status === 'unauthenticated'
                ? 'unauthenticated'
                : 'error'

    return prisma.codexConnection.update({
        where: { id: input.connectionId },
        data: {
            authStatus,
            authType: accountInfo.authType,
            accountEmail: accountInfo.accountEmail,
            accountPlan: accountInfo.accountPlan,
            lastAuthError: accountInfo.lastAuthError,
        },
    })
}

export async function readCodexRateLimits(codexHome: string) {
    const client = await CodexAppServerClient.create(codexHome)

    try {
        const response = await client.request<{
            rateLimits?: {
                credits?: {
                    balance?: string | null
                    hasCredits?: boolean
                    unlimited?: boolean
                } | null
                limitName?: string | null
                limitId?: string | null
                planType?: string | null
                primary?: {
                    usedPercent: number
                    resetsAt?: number | null
                    windowDurationMins?: number | null
                } | null
                secondary?: {
                    usedPercent: number
                    resetsAt?: number | null
                    windowDurationMins?: number | null
                } | null
            }
        }>('account/rateLimits/read', {})

        return response?.rateLimits ?? null
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read Codex rate limits.'
        if (
            message.includes('email and plan type are required') ||
            message.includes('No such file or directory')
        ) {
            return null
        }

        throw error
    } finally {
        client.close()
    }
}

export async function listCodexModels(codexHome: string) {
    const client = await CodexAppServerClient.create(codexHome)

    try {
        const response = await client.request<{
            data?: Array<{
                model?: string
                displayName?: string
                description?: string
                hidden?: boolean
                supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>
                defaultReasoningEffort?: string
            }>
        }>('model/list', { limit: 100, includeHidden: false })

        return (response.data ?? []).flatMap((model) => {
            const id = typeof model.model === 'string' ? model.model.trim() : ''
            if (!id || model.hidden) return []

            const supportedReasoningEfforts = (model.supportedReasoningEfforts ?? [])
                .map((option) => normalizeCodexReasoningEffort(option.reasoningEffort))
                .filter((effort): effort is NonNullable<typeof effort> => effort !== null)
            const defaultReasoningEffort =
                normalizeCodexReasoningEffort(model.defaultReasoningEffort) ?? supportedReasoningEfforts[0]
            if (!defaultReasoningEffort) return []

            return [{
                id,
                displayName:
                    typeof model.displayName === 'string' && model.displayName.trim()
                        ? model.displayName.trim()
                        : id,
                description: typeof model.description === 'string' ? model.description : '',
                supportedReasoningEfforts,
                defaultReasoningEffort,
            }]
        })
    } finally {
        client.close()
    }
}

export async function startCodexChatGptLogin(input: {
    connectionId: string
    ownerId: string
    codexHome: string
    type?: 'chatgpt' | 'chatgptDeviceCode'
}) {
    const existing = loginSessions.get(input.connectionId)
    if (existing) {
        existing.completedAt = Date.now()
        existing.client.close()
        loginSessions.delete(input.connectionId)
    }

    const client = await CodexAppServerClient.create(input.codexHome)
    const loginType = input.type ?? 'chatgpt'
    const result = await client.request<
        | { type: 'chatgpt'; loginId: string; authUrl: string }
        | { type: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }
    >(
        'account/login/start',
        { type: loginType }
    )

    if (result.type !== loginType) {
        client.close()
        throw new Error('Unexpected Codex login flow type.')
    }

    const session: LoginSessionRecord = {
        connectionId: input.connectionId,
        ownerId: input.ownerId,
        loginId: result.loginId,
        type: result.type,
        authUrl: result.type === 'chatgpt' ? result.authUrl : null,
        verificationUrl: result.type === 'chatgptDeviceCode' ? result.verificationUrl : null,
        userCode: result.type === 'chatgptDeviceCode' ? result.userCode : null,
        codexHome: input.codexHome,
        client,
        status: 'authorizing',
        error: null,
        startedAt: Date.now(),
        completedAt: null,
    }

    const finalize = async (status: LoginSessionStatus, error: string | null) => {
        session.status = status
        session.error = error
        session.completedAt = Date.now()
        session.client.close()

        if (status === 'error') {
            await prisma.codexConnection.update({
                where: { id: input.connectionId },
                data: {
                    authStatus: 'error',
                    authType: null,
                    accountEmail: null,
                    accountPlan: null,
                    lastAuthError: error,
                },
            }).catch(() => {})
        } else if (status === 'authenticated' || status === 'unauthenticated') {
            await syncCodexConnectionAuthState({
                connectionId: input.connectionId,
                ownerId: input.ownerId,
                codexHome: input.codexHome,
            }).catch(() => {})
        }

        setTimeout(() => {
            const current = loginSessions.get(input.connectionId)
            if (current?.loginId === session.loginId) {
                current.client.close()
                loginSessions.delete(input.connectionId)
            }
        }, SESSION_TTL_MS)
    }

    client.setNotificationHandler((message) => {
        if (message.method !== 'account/login/completed') return
        const params = message.params as { loginId?: string | null; success?: boolean; error?: string | null }
        if (params.loginId !== session.loginId) return

        if (params.success) {
            void finalize('authenticated', null)
            return
        }

        void finalize('error', params.error || 'Codex authorization failed.')
    })

    client.setExitHandler((error) => {
        if (session.completedAt) return
        void finalize('error', error.message)
    })

    loginSessions.set(input.connectionId, session)

    await prisma.codexConnection.update({
        where: { id: input.connectionId },
        data: {
            authStatus: 'authorizing',
            authType: null,
            accountEmail: null,
            accountPlan: null,
            lastAuthError: null,
        },
    })

    return {
        type: session.type,
        loginId: session.loginId,
        authUrl: session.authUrl,
        verificationUrl: session.verificationUrl,
        userCode: session.userCode,
    }
}

export function getCodexLoginSession(connectionId: string) {
    const session = loginSessions.get(connectionId)
    if (!session) return null

    if (Date.now() - session.startedAt > SESSION_TTL_MS) {
        session.completedAt = Date.now()
        session.client.close()
        loginSessions.delete(connectionId)
        return null
    }

    return {
        loginId: session.loginId,
        type: session.type,
        authUrl: session.authUrl,
        verificationUrl: session.verificationUrl,
        userCode: session.userCode,
        status: session.status,
        error: session.error,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
    }
}
