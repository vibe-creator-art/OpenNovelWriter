import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
    id: string
    username: string
    email: string
}

interface AuthState {
    token: string | null
    user: User | null
    isHydrated: boolean
    setAuth: (token: string, user: User) => void
    logout: () => void
    setHydrated: (hydrated: boolean) => void
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            token: null,
            user: null,
            isHydrated: false,
            setAuth: (token, user) => set({ token, user }),
            logout: () => set({ token: null, user: null }),
            setHydrated: (isHydrated) => set({ isHydrated }),
        }),
        {
            name: 'auth-storage',
            partialize: (state) => ({ token: state.token, user: state.user }),
            onRehydrateStorage: () => (state) => {
                // Only set hydrated AFTER rehydration is complete
                if (state) {
                    state.setHydrated(true)
                }
            },
        }
    )
)

// Locale types
export type Locale = 'zh' | 'en'

// Detect browser language
function detectBrowserLocale(): Locale {
    if (typeof navigator === 'undefined') return 'zh'
    const browserLang = navigator.language.toLowerCase()
    if (browserLang.startsWith('zh')) return 'zh'
    if (browserLang.startsWith('en')) return 'en'
    return 'zh' // default to Chinese
}

interface SettingsState {
    locale: Locale
    // When true, skip the artificial delay before opening a novel from the
    // bookshelf and navigate immediately. The loading overlay still shows for
    // as long as the real load takes.
    fastNovelOpen: boolean
    isHydrated: boolean
    setLocale: (locale: Locale) => void
    setFastNovelOpen: (fastNovelOpen: boolean) => void
    setHydrated: (hydrated: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            locale: 'zh', // Will be overwritten by browser detection on first load
            fastNovelOpen: false,
            isHydrated: false,
            setLocale: (locale) => set({ locale }),
            setFastNovelOpen: (fastNovelOpen) => set({ fastNovelOpen }),
            setHydrated: (isHydrated) => set({ isHydrated }),
        }),
        {
            name: 'settings-storage',
            partialize: (state) => ({ locale: state.locale, fastNovelOpen: state.fastNovelOpen }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // If no locale was stored (first visit), detect from browser
                    if (!localStorage.getItem('settings-storage')) {
                        state.setLocale(detectBrowserLocale())
                    }
                    state.setHydrated(true)
                }
            },
        }
    )
)
