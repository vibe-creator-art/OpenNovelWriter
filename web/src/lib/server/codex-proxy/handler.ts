import { NextRequest, NextResponse } from 'next/server'

import { expandNativeCodexModels, parseCodexProviderModelsJson, parseCodexUpstreamFormat } from '@/lib/codex-config'
import { getPrismaClient } from '@/lib/db'
import { decryptApiKey } from '@/lib/server/ai-credentials'
import { isValidCodexProxyToken } from '@/lib/server/codex-internal-auth'
import { codexChatHistory } from '@/lib/server/codex-proxy/history'
import { createChatToResponsesStream } from '@/lib/server/codex-proxy/stream'
import { createResponsesNamespaceStream } from '@/lib/server/codex-proxy/responses-stream'
import {
    CodexToolContext,
    isObject,
    normalizeCodexResponsesTools,
    rewriteNamespacedResponse,
} from '@/lib/server/codex-proxy/tool-context'
import { chatCompletionToResponse, responsesToChatRequest } from '@/lib/server/codex-proxy/transform'

const prisma = getPrismaClient({ ensureModel: 'codexConnection' })

type JsonObject = Record<string, unknown>

export async function handleCodexUpstreamRequest(input: {
    request: NextRequest
    connectionId: string
    path: string[]
}) {
    if (!isAuthorized(input.request, input.connectionId)) {
        return NextResponse.json({ error: { message: 'Unauthorized', type: 'authentication_error' } }, { status: 401 })
    }

    const endpoint = normalizeEndpoint(input.path)
    if (endpoint !== 'responses' && endpoint !== 'responses/compact') {
        return NextResponse.json({ error: { message: 'Unsupported Codex proxy endpoint.' } }, { status: 404 })
    }

    const connection = await prisma.codexConnection.findFirst({
        where: { id: input.connectionId, providerType: 'custom' },
    })
    if (!connection) {
        return NextResponse.json({ error: { message: 'Codex connection not found.' } }, { status: 404 })
    }

    const upstreamFormat = parseCodexUpstreamFormat(connection.upstreamFormat)
    const baseUrl = connection.baseUrl?.trim().replace(/\/+$/, '')
    const encryptedApiKey = connection.encryptedApiKey
    const models = expandNativeCodexModels(parseCodexProviderModelsJson(connection.modelsJson))
    if (!upstreamFormat || !baseUrl || !encryptedApiKey || models.length === 0) {
        return NextResponse.json({ error: { message: 'Codex connection is incomplete.' } }, { status: 500 })
    }

    let body: JsonObject
    let toolContext: CodexToolContext
    try {
        const parsed = await input.request.json() as unknown
        if (!isObject(parsed)) throw new Error('Expected a JSON object.')
        toolContext = CodexToolContext.fromRequest(parsed)
        body = normalizeCodexResponsesTools(parsed)
    } catch (error) {
        return NextResponse.json({
            error: { message: error instanceof Error ? error.message : 'Invalid JSON request.' },
        }, { status: 400 })
    }

    const modelId = typeof body.model === 'string' ? body.model.trim() : ''
    const model = models.find((candidate) => candidate.id === modelId)
    if (!model) {
        return NextResponse.json({
            error: { message: `Model ${modelId || '(missing)'} is not configured for this Codex connection.` },
        }, { status: 400 })
    }

    try {
        const apiKey = decryptApiKey(encryptedApiKey)
        if (upstreamFormat === 'responses') {
            return proxyResponsesRequest({ request: input.request, baseUrl, apiKey, endpoint, body, context: toolContext })
        }
        return proxyChatRequest({ request: input.request, baseUrl, apiKey, body, model, context: toolContext })
    } catch (error) {
        console.error('Codex upstream proxy error:', error)
        return NextResponse.json({
            error: {
                message: error instanceof Error ? error.message : 'Codex upstream request failed.',
                type: 'upstream_error',
            },
        }, { status: 502 })
    }
}

async function proxyResponsesRequest(input: {
    request: NextRequest
    baseUrl: string
    apiKey: string
    endpoint: string
    body: JsonObject
    context: CodexToolContext
}) {
    const upstream = await fetch(buildUrl(input.baseUrl, input.endpoint, input.request.nextUrl.search), {
        method: 'POST',
        headers: upstreamHeaders(input.request, input.apiKey),
        body: JSON.stringify(input.body),
        signal: input.request.signal,
        cache: 'no-store',
    })
    if (!upstream.ok || !upstream.body) return forwardUpstreamResponse(upstream)
    if (upstream.headers.get('content-type')?.includes('text/event-stream')) {
        return new Response(createResponsesNamespaceStream({ upstream: upstream.body, context: input.context }), {
            status: upstream.status,
            headers: {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache, no-transform',
                'x-accel-buffering': 'no',
            },
        })
    }
    const parsed = await upstream.json() as unknown
    return NextResponse.json(rewriteNamespacedResponse(parsed, input.context), { status: upstream.status })
}

async function proxyChatRequest(input: {
    request: NextRequest
    baseUrl: string
    apiKey: string
    body: JsonObject
    model: ReturnType<typeof parseCodexProviderModelsJson>[number]
    context: CodexToolContext
}) {
    const enriched = codexChatHistory.enrich(input.body)
    const chatBody = responsesToChatRequest(enriched, input.model, input.context)
    const upstream = await fetch(buildUrl(input.baseUrl, 'chat/completions', input.request.nextUrl.search), {
        method: 'POST',
        headers: upstreamHeaders(input.request, input.apiKey),
        body: JSON.stringify(chatBody),
        signal: input.request.signal,
        cache: 'no-store',
    })

    if (!upstream.ok) return forwardUpstreamResponse(upstream)
    if (!upstream.body) throw new Error('Chat upstream returned an empty response body.')

    if (chatBody.stream === true) {
        const stream = createChatToResponsesStream({
            upstream: upstream.body,
            context: input.context,
            onComplete: (response) => codexChatHistory.record(response),
        })
        return new Response(stream, {
            status: upstream.status,
            headers: {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache, no-transform',
                connection: 'keep-alive',
                'x-accel-buffering': 'no',
            },
        })
    }

    const parsed = await upstream.json() as unknown
    if (!isObject(parsed)) throw new Error('Chat upstream returned invalid JSON.')
    const response = chatCompletionToResponse(parsed, input.context)
    codexChatHistory.record(response)
    return NextResponse.json(response, { status: upstream.status })
}

function isAuthorized(request: NextRequest, connectionId: string) {
    const authorization = request.headers.get('authorization')
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    const apiKey = request.headers.get('x-api-key')?.trim()
    return isValidCodexProxyToken(connectionId, bearer || apiKey)
}

function normalizeEndpoint(pathParts: string[]) {
    const path = pathParts.filter(Boolean).join('/')
    return path.startsWith('v1/') ? path.slice(3) : path
}

function buildUrl(baseUrl: string, endpoint: string, search: string) {
    const normalizedEndpoint = endpoint.replace(/^\/+/, '')
    return `${baseUrl}/${normalizedEndpoint}${search}`
}

function upstreamHeaders(request: NextRequest, apiKey: string) {
    const headers = new Headers({
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: request.headers.get('accept') || 'application/json',
    })
    const userAgent = request.headers.get('user-agent')
    if (userAgent) headers.set('user-agent', userAgent)
    return headers
}

async function forwardUpstreamResponse(upstream: Response) {
    const headers = new Headers()
    for (const name of ['content-type', 'cache-control', 'retry-after', 'request-id', 'x-request-id']) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
    }
    if (headers.get('content-type')?.includes('text/event-stream')) {
        headers.set('x-accel-buffering', 'no')
        headers.set('cache-control', 'no-cache, no-transform')
    }
    return new Response(upstream.body, { status: upstream.status, headers })
}
