export const APP_COLOR_THEME_STORAGE_KEY = 'onw-color-theme'

export const APP_COLOR_THEMES = ['light', 'eyeCare', 'dark'] as const

export type AppColorTheme = (typeof APP_COLOR_THEMES)[number]

export const DEFAULT_APP_COLOR_THEME: AppColorTheme = 'light'

export function applyAppColorTheme(theme: AppColorTheme) {
    if (typeof document === 'undefined') return

    const root = document.documentElement
    root.dataset.colorTheme = theme
    root.classList.toggle('dark', theme === 'dark')
}
