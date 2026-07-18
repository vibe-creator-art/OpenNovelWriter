'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
    applyAppColorTheme,
    DEFAULT_APP_COLOR_THEME,
    APP_COLOR_THEME_STORAGE_KEY,
    type AppColorTheme,
} from '@/lib/app-theme'

type AppThemeState = {
    colorTheme: AppColorTheme
    setColorTheme: (colorTheme: AppColorTheme) => void
    resetColorTheme: () => void
}

export const useAppThemeStore = create<AppThemeState>()(
    persist(
        (set) => ({
            colorTheme: DEFAULT_APP_COLOR_THEME,
            setColorTheme: (colorTheme) => {
                applyAppColorTheme(colorTheme)
                set({ colorTheme })
            },
            resetColorTheme: () => {
                applyAppColorTheme(DEFAULT_APP_COLOR_THEME)
                set({ colorTheme: DEFAULT_APP_COLOR_THEME })
            },
        }),
        {
            name: APP_COLOR_THEME_STORAGE_KEY,
            partialize: (state) => ({ colorTheme: state.colorTheme }),
            onRehydrateStorage: () => (state) => {
                if (state) applyAppColorTheme(state.colorTheme)
            },
        }
    )
)
