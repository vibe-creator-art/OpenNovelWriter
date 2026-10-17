const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { createJiti } = require('jiti')

const src = path.resolve(__dirname, '../..')
const jiti = createJiti(__filename, { alias: { '@': src } })
const { createLanguageModel, fetchModelsForProvider } = jiti('@/lib/server/ai-providers')
const { createDefaultCodexProviderModel } = jiti('@/lib/codex-config')
const { getCodexOpenCodeGoConfig, isOpenCodeGoBaseUrl } = jiti('@/lib/server/opencode-go')
const { generateText, streamText } = require('ai')
const baseUrl = 'https://opencode.ai/inference/go/openai/v1'
const geminiBaseUrl = 'https://opencode.ai/inference/go/google/v1beta'
const anthropicBaseUrl = 'https://opencode.ai/inference/go/anthropic/v1'
const modelsUrl = 'https://opencode.ai/inference/go/v1/models'
const sessionHeader = 'x-opencode-session'

function load(relative, mocks) {
    const output = ts.transpileModule(fs.readFileSync(path.join(src, relative), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    new Function('require', 'module', 'exports', output)((name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        return name.startsWith('@/') ? jiti(name) : require(name)
    }, module, module.exports)
    return module.exports
}

function chatResponse() {
    return Response.json({ id: 'chat-test', object: 'chat.completion', created: 0, model: 'go-test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
}

test('AI chat sends stable conversation headers only to the official Go endpoint', async (t) => {
    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        requests.push({ url: String(url), headers: new Headers(init.headers) })
        return chatResponse()
    })
    const targets = [baseUrl, `${baseUrl}/`, baseUrl,
        'https://opencode.ai/zen/v1', 'https://opencode.ai.example/inference/go/openai/v1',
        'http://opencode.ai/inference/go/openai/v1', 'https://proxy.example/v1',
        'https://opencode.ai/zen/go/v1']
    for (const [index, target] of targets.entries()) {
        const model = createLanguageModel({ providerType: 'openai-chat', apiKey: 'test-key',
            baseUrl: target, modelId: 'go-test', sessionId: index < 2 ? 'conversation-a' : 'conversation-b' })
        assert.equal((await generateText({ model, prompt: 'Hello' })).text, 'OK')
    }
    assert.deepEqual(requests.map(({ headers }) => headers.get(sessionHeader)),
        ['conversation-a', 'conversation-a', 'conversation-b', null, null, null, null, null])
    for (const request of requests.slice(0, 3)) {
        assert.match(request.headers.get('user-agent'), /^OpenNovelWriter\/0\.1\.0(?: |$)/)
        assert.equal(request.headers.get('authorization'), 'Bearer test-key')
        assert.equal(request.url, `${baseUrl}/chat/completions`)
    }
    for (const request of requests.slice(3)) assert.doesNotMatch(request.headers.get('user-agent'), /OpenNovelWriter/)
})

test('Codex forwards each session through Responses, Chat and Anthropic without changing other providers', async (t) => {
    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        requests.push({ url: String(url), headers: new Headers(init.headers) })
        if (String(url).endsWith('/chat/completions')) return chatResponse()
        if (String(url).endsWith('/messages')) return Response.json({ id: 'message-test', type: 'message', role: 'assistant',
            model: 'go-test', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
        return Response.json({ id: 'response-test', object: 'response', status: 'completed', output: [] })
    })
    const formats = ['responses', 'chat-completions', 'anthropic-messages']
    const baseUrls = { responses: baseUrl, 'chat-completions': baseUrl, 'anthropic-messages': anthropicBaseUrl }
    const { handleCodexUpstreamRequest } = load('lib/server/codex-proxy/handler.ts', {
        '@/lib/db': { getPrismaClient: () => ({ codexConnection: { findFirst: async ({ where }) => ({
            id: where.id, ownerId: 'owner', upstreamFormat: where.id.replace('other-', ''),
            baseUrl: where.id.startsWith('other-') ? 'https://proxy.example/v1' : baseUrls[where.id],
            encryptedApiKey: 'test-key', modelsJson: JSON.stringify([createDefaultCodexProviderModel('go-test')]),
        }) } }) },
        '@/lib/server/ai-credentials': { decryptApiKey: (value) => value },
        '@/lib/server/codex-internal-auth': { isValidCodexProxyToken: () => true },
    })
    const { NextRequest } = require('next/server')
    for (const sessionId of ['session-a', 'session-b', 'session-a']) {
        await Promise.all(formats.flatMap((format) => [format, `other-${format}`]).map(async (connectionId) => {
            const request = new NextRequest('http://localhost/upstream/responses', {
                method: 'POST', headers: { authorization: 'Bearer local-token', [sessionHeader]: sessionId, 'user-agent': 'codex-test' },
                body: JSON.stringify({ model: 'go-test', stream: false, input: [{ role: 'user', content: 'Hello' }] }),
            })
            const response = await handleCodexUpstreamRequest({ request, connectionId, path: ['responses'] })
            assert.equal(response.status, 200)
        }))
    }
    for (const [format, suffix] of Object.entries({ responses: '/responses', 'chat-completions': '/chat/completions', 'anthropic-messages': '/messages' })) {
        const goRequests = requests.filter(({ url }) => url === `${baseUrls[format]}${suffix}`)
        assert.deepEqual(goRequests.map(({ headers }) => headers.get(sessionHeader)), ['session-a', 'session-b', 'session-a'])
        assert.ok(goRequests.every(({ headers }) => headers.get('user-agent') === 'OpenNovelWriter/0.1.0'))
        const otherRequests = requests.filter(({ url }) => url === `https://proxy.example/v1${suffix}`)
        assert.equal(otherRequests.length, 3)
        assert.ok(otherRequests.every(({ headers }) => !headers.has(sessionHeader) && headers.get('user-agent') === 'codex-test'))
    }
})

test('Go Gemini discovers only Gemini models from the shared catalog', async (t) => {
    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        requests.push({ url: String(url), headers: new Headers(init.headers) })
        return Response.json({ object: 'list', data: [
            { id: 'gemini-4-argon-contributor' }, { id: 'kimi-k3' }, { id: 'gpt-6-luna' },
        ] })
    })
    const models = await fetchModelsForProvider({ providerType: 'gemini', baseUrl: geminiBaseUrl, apiKey: 'test-key' })
    assert.deepEqual(models, [{ id: 'gemini-4-argon-contributor', name: 'gemini-4-argon-contributor' }])
    assert.equal(requests[0].url, modelsUrl)
    assert.equal(requests[0].headers.get('authorization'), 'Bearer test-key')
    assert.equal(requests[0].headers.get('user-agent'), 'OpenNovelWriter/0.1.0')
    assert.equal(requests[0].headers.get(sessionHeader), null)
})

test('Google model discovery keeps its native endpoint and authentication', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models')
        const headers = new Headers(init.headers)
        assert.equal(headers.get('x-goog-api-key'), 'google-key')
        assert.equal(headers.get('authorization'), null)
        return Response.json({ models: [{ name: 'models/gemini-test', displayName: 'Gemini Test' }] })
    })
    assert.deepEqual(await fetchModelsForProvider({ providerType: 'gemini', apiKey: 'google-key' }),
        [{ id: 'gemini-test', name: 'Gemini Test' }])
})

test('Go Gemini rejects an empty catalog and propagates upstream errors', async (t) => {
    const options = { providerType: 'gemini', baseUrl: geminiBaseUrl, apiKey: 'test-key' }
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ id: 'kimi-k3' }] }))
    await assert.rejects(fetchModelsForProvider(options), /No models are available/)
    mock.mock.mockImplementation(async () => Response.json({ error: { message: 'Invalid Go key' } }, { status: 401 }))
    await assert.rejects(fetchModelsForProvider(options), /Invalid Go key/)
})

test('Codex Go model discovery uses the shared catalog for all three formats', async (t) => {
    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        requests.push({ url: String(url), headers: new Headers(init.headers) })
        return Response.json({ data: [{ id: 'go-test' }] })
    })
    const { POST } = load('app/api/codex/models/route.ts', {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/db': { getPrismaClient: () => ({}) },
    })
    for (const [upstreamFormat, target] of [
        ['responses', baseUrl], ['chat-completions', baseUrl], ['anthropic-messages', anthropicBaseUrl],
    ]) {
        const response = await POST(new Request('http://localhost/models', {
            method: 'POST', body: JSON.stringify({ upstreamFormat, baseUrl: target, apiKey: 'test-key' }),
        }))
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { models: [{ id: 'go-test', name: 'go-test' }] })
    }
    assert.ok(requests.every(({ url, headers }) => url === modelsUrl && headers.get('authorization') === 'Bearer test-key'))
})

test('Gemini uses native generation and streaming with stable Go sessions', async (t) => {
    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) })
        const response = {
            candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'OK', thoughtSignature: 'text-signature' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
        }
        return String(url).includes(':streamGenerateContent')
            ? new Response(`data: ${JSON.stringify(response)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
            : Response.json(response)
    })
    for (const [sessionId, stream] of [['conversation-a', false], ['conversation-a', true], ['conversation-b', false]]) {
        const model = createLanguageModel({ providerType: 'gemini', apiKey: 'test-key', baseUrl: geminiBaseUrl,
            modelId: 'gemini-4-argon-contributor', sessionId })
        const options = { model, system: 'Write a story.', prompt: 'Continue.', maxOutputTokens: 128 }
        if (stream) {
            const result = streamText(options)
            let text = ''
            for await (const part of result.textStream) text += part
            assert.equal(text, 'OK')
            assert.equal(await result.reasoningText, undefined)
        } else {
            const result = await generateText(options)
            assert.equal(result.text, 'OK')
            assert.equal(result.reasoningText, undefined)
        }
    }
    assert.deepEqual(requests.map(({ headers }) => headers.get(sessionHeader)), ['conversation-a', 'conversation-a', 'conversation-b'])
    assert.deepEqual(requests.map(({ url }) => url), [
        `${geminiBaseUrl}/models/gemini-4-argon-contributor:generateContent`,
        `${geminiBaseUrl}/models/gemini-4-argon-contributor:streamGenerateContent?alt=sse`,
        `${geminiBaseUrl}/models/gemini-4-argon-contributor:generateContent`,
    ])
    for (const { headers, body } of requests) {
        assert.equal(headers.get('x-goog-api-key'), 'test-key')
        assert.match(headers.get('user-agent'), /^OpenNovelWriter\/0\.1\.0(?: |$)/)
        assert.deepEqual(body.systemInstruction, { parts: [{ text: 'Write a story.' }] })
        assert.equal(body.generationConfig.maxOutputTokens, 128)
    }
})

test('Gemini sends Go headers only to the current official endpoints', async (t) => {
    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        requests.push(new Headers(init.headers))
        return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] })
    })
    for (const target of [geminiBaseUrl, 'https://generativelanguage.googleapis.com/v1beta',
        'https://opencode.ai.example/inference/go/google/v1beta', 'https://proxy.example/v1beta']) {
        const model = createLanguageModel({ providerType: 'gemini', baseUrl: target, apiKey: 'test-key', modelId: 'gemini-test', sessionId: 'conversation-a' })
        await generateText({ model, prompt: 'Hello' })
    }
    assert.deepEqual(requests.map((headers) => headers.get(sessionHeader)), ['conversation-a', null, null, null])
    for (const headers of requests.slice(1)) assert.doesNotMatch(headers.get('user-agent'), /OpenNovelWriter/)
    assert.throws(() => createLanguageModel({ providerType: 'gemini', baseUrl: geminiBaseUrl, apiKey: 'test-key', modelId: 'gemini-test' }), /conversation ID/)
    for (const target of [baseUrl, anthropicBaseUrl, geminiBaseUrl]) {
        assert.equal(isOpenCodeGoBaseUrl(` ${target}/ `), true)
        assert.deepEqual(getCodexOpenCodeGoConfig({ providerType: 'custom', baseUrl: target }, 'conversation-a'),
            { 'model_providers.opennovelwriter.http_headers': { [sessionHeader]: 'conversation-a' } })
    }
})

test('browser and run_llm routes pass the conversation identity to model execution', async () => {
    const calls = []
    const mocks = {
        '@/lib/auth': { getCurrentUser: async () => ({ userId: 'owner' }) },
        '@/lib/server/codex-internal-auth': { isValidCodexInternalToken: () => true },
        '@/lib/server/model-group-runner': {
            loadModelGroupForOwner: async () => ({ name: 'test' }),
            runModelGroupWithFallbackOnServer: async (options) => {
                calls.push(options.input)
                return { text: 'OK', usedAssignment: { modelId: 'go-test' } }
            },
        },
    }
    for (const routePath of ['app/api/ai/run-group/route.ts', 'app/api/internal/codex/run-llm/route.ts']) {
        const { POST } = load(routePath, mocks)
        const response = await POST(new Request('http://localhost/run', { method: 'POST', body: JSON.stringify({
            ownerId: 'owner', groupId: 'group', sessionId: 'conversation-a', messages: [{ role: 'user', content: 'Hello' }],
        }) }))
        assert.equal(response.status, 200)
        await response.text()
    }
    assert.deepEqual(calls.map(({ sessionId }) => sessionId), ['conversation-a', 'conversation-a'])
})
