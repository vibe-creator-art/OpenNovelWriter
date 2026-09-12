'use client'

import { create } from 'zustand'
import { codexSessionApi, type CodexSessionMessage } from '@/lib/api'

type WorkDetails = {
    version: string
    loading: boolean
    message: CodexSessionMessage | null
    error: string | null
}

export const useCodexWorkDetailsStore = create<{
    details: Record<string, Record<string, WorkDetails>>
    load: (sessionId: string, messageId: string, version: string) => Promise<void>
    clear: (sessionId: string) => void
}>()((set, get) => ({
    details: {},
    clear: (sessionId) => set((state) => {
        const details = { ...state.details }
        delete details[sessionId]
        return { details }
    }),
    load: async (sessionId, messageId, version) => {
        const current = get().details[sessionId]?.[messageId]
        if (current?.version === version && (current.loading || current.message)) return
        const pending: WorkDetails = { version, loading: true, message: null, error: null }
        const update = (value: WorkDetails) => set((state) => ({
            details: { ...state.details, [sessionId]: { ...state.details[sessionId], [messageId]: value } },
        }))
        update(pending)
        try {
            const result = await codexSessionApi.getMessage(sessionId, messageId)
            if (get().details[sessionId]?.[messageId] !== pending) return
            update({ version, loading: false, message: result.message, error: null })
        } catch (error) {
            if (get().details[sessionId]?.[messageId] !== pending) return
            update({ version, loading: false, message: null, error: error instanceof Error ? error.message : String(error) })
        }
    },
}))
