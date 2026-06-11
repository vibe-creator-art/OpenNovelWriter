import { create } from 'zustand'

type FallbackToast = {
    id: string
    message: string
    startedAt: number
    durationMs: number
}

type FatalDialog = {
    title: string
    description: string
}

type AiRunUiState = {
    toast: FallbackToast | null
    fatal: FatalDialog | null
    showToast: (message: string, options?: { durationMs?: number }) => void
    hideToast: (id?: string) => void
    showFatal: (title: string, description: string) => void
    hideFatal: () => void
}

function createId() {
    return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const useAiRunUiStore = create<AiRunUiState>()((set, get) => ({
    toast: null,
    fatal: null,
    showToast: (message, options) => {
        const durationMs = typeof options?.durationMs === 'number' ? options.durationMs : 10_000
        set({
            toast: {
                id: createId(),
                message,
                startedAt: Date.now(),
                durationMs,
            },
        })
    },
    hideToast: (id) => {
        const toast = get().toast
        if (!toast) return
        if (id && toast.id !== id) return
        set({ toast: null })
    },
    showFatal: (title, description) => set({ fatal: { title, description } }),
    hideFatal: () => set({ fatal: null }),
}))

