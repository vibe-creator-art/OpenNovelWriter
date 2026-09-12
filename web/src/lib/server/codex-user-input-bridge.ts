import { randomUUID } from 'node:crypto'
import type { CodexUserInputRequest, CodexUserInputResponse } from '@/lib/codex-user-input'

type PendingQuestion = {
    request: CodexUserInputRequest
    nativeRequestId: string | null
    novelId: string
    answer: (response: CodexUserInputResponse) => Promise<void>
    cancel: () => void
    submitting: boolean
    onResolved: (id: string) => void
}

const stateKey = Symbol.for('openNovelWriter.codexUserInput')
const state = globalThis as typeof globalThis & { [stateKey]?: Map<string, PendingQuestion> }
const pending = (state[stateKey] ??= new Map<string, PendingQuestion>())

export class CodexUserInputCancelledError extends Error {
    constructor() {
        super('Codex question is no longer pending.')
    }
}

export function createCodexUserInputRequest(sessionId: string, params: Record<string, unknown>): CodexUserInputRequest {
    if (
        typeof params.threadId !== 'string' || typeof params.turnId !== 'string'
        || typeof params.itemId !== 'string'
        || !Array.isArray(params.questions) || params.questions.length === 0
    ) throw new Error('Invalid Codex question request.')

    const ids = new Set<string>()
    const questions = params.questions.map((value) => {
        if (!value || typeof value !== 'object') throw new Error('Invalid Codex question.')
        const question = value as Record<string, unknown>
        if (typeof question.id !== 'string' || !question.id || ids.has(question.id)
            || typeof question.header !== 'string' || typeof question.question !== 'string') {
            throw new Error('Invalid Codex question.')
        }
        ids.add(question.id)
        const options = question.options == null ? null : question.options
        if (options !== null && (!Array.isArray(options) || options.some((option) =>
            !option || typeof option.label !== 'string' || typeof option.description !== 'string'
        ))) throw new Error('Invalid Codex question options.')
        return {
            id: question.id,
            header: question.header,
            question: question.question,
            isOther: question.isOther === true,
            isSecret: question.isSecret === true,
            options: options as CodexUserInputRequest['questions'][number]['options'],
        }
    })
    return {
        id: randomUUID(), sessionId,
        threadId: params.threadId, turnId: params.turnId, itemId: params.itemId,
        delivery: 'tool-response', questions,
    }
}

export function waitForCodexUserInput(request: CodexUserInputRequest, nativeRequestId: string, novelId: string, onResolved: (id: string) => void) {
    return new Promise<CodexUserInputResponse>((resolve, reject) => {
        pending.set(request.id, {
            request, nativeRequestId, novelId, onResolved, submitting: false,
            answer: async (response) => { resolve(response) },
            cancel: () => reject(new CodexUserInputCancelledError()),
        })
    })
}

export function createAsyncCodexUserInputRequest(sessionId: string, threadId: string, turnId: string, item: Record<string, unknown>) {
    if (item.type !== 'agentMessage' || item.delivery !== 'async' || !Array.isArray(item.questions) || !item.questions.length) return null
    const request = createCodexUserInputRequest(sessionId, {
        threadId, turnId, itemId: item.id,
        questions: item.questions.map((question, index) => ({
            id: `${item.id}:${index}`, header: '', question: question.title, isOther: true,
            options: Array.isArray(question.options) ? question.options.map((label: string) => ({ label, description: '' })) : null,
        })),
    })
    return { ...request, delivery: 'async-message' as const }
}

export function registerAsyncCodexUserInput(request: CodexUserInputRequest, novelId: string, answer: PendingQuestion['answer'], onResolved: PendingQuestion['onResolved']) {
    pending.set(request.id, { request, nativeRequestId: null, novelId, answer, onResolved, submitting: false, cancel: () => {} })
}

export function formatCodexUserInputAnswer(request: CodexUserInputRequest, response: CodexUserInputResponse) {
    return request.questions.map((question) => {
        const answer = response.answers[question.id]?.answers.join('\n') ?? ''
        return `${question.question}\n${answer}`
    }).join('\n\n')
}

export function listCodexUserInputRequests(sessionId: string) {
    return [...pending.values()].filter((item) => item.request.sessionId === sessionId).map((item) => item.request)
}

export async function resolveCodexUserInput(sessionId: string, id: string, value: unknown) {
    const entry = pending.get(id)
    if (!entry || entry.request.sessionId !== sessionId) return { ok: false as const, status: 409, detail: 'Question is no longer pending.' }
    if (entry.submitting) return { ok: false as const, status: 409, detail: 'Answer is already being submitted.' }
    const answers = value && typeof value === 'object' ? (value as Record<string, unknown>).answers : null
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return { ok: false as const, status: 400, detail: 'Invalid question answers.' }
    }
    const ids = new Set(entry.request.questions.map((question) => question.id))
    const response: CodexUserInputResponse = { answers: {} }
    for (const [questionId, value] of Object.entries(answers)) {
        const strings = value && typeof value === 'object' ? (value as Record<string, unknown>).answers : null
        if (!ids.has(questionId) || !Array.isArray(strings) || strings.some((answer) => typeof answer !== 'string')) {
            return { ok: false as const, status: 400, detail: 'Invalid question answers.' }
        }
        Object.defineProperty(response.answers, questionId, { value: { answers: strings }, enumerable: true })
    }
    entry.submitting = true
    try {
        await entry.answer(response)
    } catch (error) {
        entry.submitting = false
        return { ok: false as const, status: 409, detail: error instanceof Error ? error.message : 'Could not submit answer.' }
    }
    if (pending.get(id) === entry) {
        pending.delete(id)
        entry.onResolved(id)
    }
    return { ok: true as const }
}

export function clearCodexUserInputRequests(sessionId: string, turnId?: string) {
    for (const [id, entry] of pending) {
        if (entry.request.sessionId !== sessionId || (turnId && entry.request.turnId !== turnId)) continue
        pending.delete(id)
        entry.cancel()
        entry.onResolved(id)
    }
}

export function skipCodexUserInputForNovel(novelId: string) {
    for (const [id, entry] of pending) {
        if (entry.novelId !== novelId) continue
        if (entry.nativeRequestId !== null) {
            void resolveCodexUserInput(entry.request.sessionId, id, { answers: {} })
        } else {
            pending.delete(id)
            entry.onResolved(id)
        }
    }
}

export function clearCodexUserInputRequest(sessionId: string, nativeRequestId: string) {
    for (const [id, entry] of pending) {
        if (entry.request.sessionId !== sessionId || entry.nativeRequestId !== nativeRequestId) continue
        pending.delete(id)
        entry.cancel()
        entry.onResolved(id)
    }
}
