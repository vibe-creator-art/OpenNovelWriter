import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    CodexUserInputCancelledError, clearCodexUserInputRequest, clearCodexUserInputRequests,
    createCodexUserInputRequest, listCodexUserInputRequests, resolveCodexUserInput,
    skipCodexUserInputForNovel, waitForCodexUserInput,
    createAsyncCodexUserInputRequest, registerAsyncCodexUserInput, formatCodexUserInputAnswer,
} from './codex-user-input-bridge'

function request(sessionId: string, isBlocking = true) {
    return createCodexUserInputRequest(sessionId, {
        threadId: 'thread', turnId: 'turn', itemId: 'item', isBlocking,
        questions: [{ id: 'direction', header: 'Direction', question: 'Which direction?', options: [{ label: 'North', description: 'Take the northern route.' }] }],
    })
}

for (const isBlocking of [true, false]) {
    test(`native tool requests return answers under their original ids with isBlocking=${isBlocking}`, async () => {
        const item = request(`answers-${isBlocking}`, isBlocking)
        const resolved: string[] = []
        const result = waitForCodexUserInput(item, 'native-1', 'novel', (id) => resolved.push(id))
        assert.equal(listCodexUserInputRequests(item.sessionId)[0].delivery, 'tool-response')
        const response = { answers: { direction: { answers: ['A free-text answer'] } } }
        assert.equal((await resolveCodexUserInput('another-session', item.id, response)).ok, false)
        assert.equal((await resolveCodexUserInput(item.sessionId, item.id, { answers: [] })).ok, false)
        assert.equal((await resolveCodexUserInput(item.sessionId, item.id, { answers: { unknown: { answers: ['North'] } } })).ok, false)
        assert.equal(listCodexUserInputRequests(item.sessionId).length, 1)
        assert.equal((await resolveCodexUserInput(item.sessionId, item.id, response)).ok, true)
        assert.deepEqual(await result, response)
        assert.deepEqual(resolved, [item.id])
        assert.equal((await resolveCodexUserInput(item.sessionId, item.id, response)).ok, false)
    })
}

test('skipping a Default-mode native request with isBlocking=false releases the waiting tool', async () => {
    const item = request('default-skip', false)
    assert.equal(item.delivery, 'tool-response')
    let resumed = false
    const result = waitForCodexUserInput(item, 'native-default', 'novel', () => {}).then((response) => {
        resumed = true
        return response
    })
    await Promise.resolve()
    assert.equal(resumed, false)
    assert.equal((await resolveCodexUserInput(item.sessionId, item.id, { answers: {} })).ok, true)
    assert.deepEqual(await result, { answers: {} })
    assert.equal(resumed, true)
    assert.deepEqual(listCodexUserInputRequests(item.sessionId), [])
})

test('stop and native resolution cancel waiting without manufacturing an answer', async () => {
    const first = request('cancel')
    const second = request('cancel', false)
    const firstResult = waitForCodexUserInput(first, '1', 'novel', () => {})
    const secondResult = waitForCodexUserInput(second, '2', 'novel', () => {})
    const firstRejected = assert.rejects(firstResult, CodexUserInputCancelledError)
    clearCodexUserInputRequest('cancel', '1')
    await firstRejected
    assert.deepEqual(listCodexUserInputRequests('cancel').map((item) => item.id), [second.id])
    const secondRejected = assert.rejects(secondResult, CodexUserInputCancelledError)
    clearCodexUserInputRequests('cancel')
    await secondRejected
    assert.deepEqual(listCodexUserInputRequests('cancel'), [])
})

test('disabling clarification skips only pending questions for that novel', async () => {
    const first = request('disabled')
    const second = request('other')
    const firstResult = waitForCodexUserInput(first, '1', 'novel', () => {})
    const secondResult = waitForCodexUserInput(second, '1', 'another-novel', () => {})
    skipCodexUserInputForNovel('novel')
    assert.deepEqual(await firstResult, { answers: {} })
    assert.equal(listCodexUserInputRequests('other').length, 1)
    await resolveCodexUserInput(second.sessionId, second.id, { answers: {} })
    await secondResult
})

test('native async assistant questions return user text without holding up the turn', async () => {
    assert.equal(createAsyncCodexUserInputRequest('async-message', 'thread', 'turn', { type: 'agentMessage', delivery: 'normal' }), null)
    const item = createAsyncCodexUserInputRequest('async-message', 'thread', 'turn', {
        type: 'agentMessage', id: 'question-item', delivery: 'async',
        questions: [{ title: 'Which direction?', options: ['North', 'South'] }, { title: 'Why?' }],
    })!
    assert.equal(item.delivery, 'async-message')
    assert.deepEqual(item.questions.map((question) => question.id), ['question-item:0', 'question-item:1'])
    const messages: string[] = []
    let release!: () => void
    const delivered = new Promise<void>((resolve) => { release = resolve })
    registerAsyncCodexUserInput(item, 'async-novel', async (response) => {
        messages.push(formatCodexUserInputAnswer(item, response))
        await delivered
    }, () => {})
    assert.equal(messages.length, 0)
    const response = { answers: { 'question-item:0': { answers: ['North'] }, 'question-item:1': { answers: ['It is nearer.'] } } }
    const submission = resolveCodexUserInput(item.sessionId, item.id, response)
    assert.equal((await resolveCodexUserInput(item.sessionId, item.id, response)).ok, false)
    release()
    assert.equal((await submission).ok, true)
    assert.deepEqual(messages, ['Which direction?\nNorth\n\nWhy?\nIt is nearer.'])
    assert.deepEqual(listCodexUserInputRequests(item.sessionId), [])
})

test('async answers can retry after delivery failure and disabling does not invent an answer', async () => {
    const item = createAsyncCodexUserInputRequest('async-retry', 'thread', 'turn', {
        type: 'agentMessage', id: 'retry-item', delivery: 'async', questions: [{ title: 'Which direction?' }],
    })!
    let attempts = 0
    registerAsyncCodexUserInput(item, 'async-disable', async () => {
        attempts++
        throw new Error('Delivery failed')
    }, () => {})
    assert.equal((await resolveCodexUserInput(item.sessionId, item.id, { answers: {} })).ok, false)
    assert.equal(listCodexUserInputRequests(item.sessionId).length, 1)
    skipCodexUserInputForNovel('async-disable')
    assert.equal(attempts, 1)
    assert.deepEqual(listCodexUserInputRequests(item.sessionId), [])
})
