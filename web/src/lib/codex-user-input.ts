export type CodexUserInputQuestion = {
    id: string
    header: string
    question: string
    isOther: boolean
    isSecret: boolean
    options: Array<{ label: string; description: string }> | null
}

export type CodexUserInputRequest = {
    id: string
    sessionId: string
    threadId: string
    turnId: string
    itemId: string
    delivery: 'tool-response' | 'async-message'
    questions: CodexUserInputQuestion[]
}

export type CodexUserInputResponse = {
    answers: Record<string, { answers: string[] }>
}
