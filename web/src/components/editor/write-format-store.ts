'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type WriteFontFamily =
    // Sans serif
    | 'sans'
    | 'arial'
    | 'helvetica'
    // Serif
    | 'serif'
    | 'times'
    | 'georgia'
    | 'palatino'
    // Monospace
    | 'mono'
    | 'menlo'
    | 'consolas'
    | 'courier'
export type WriteTextSize = 'sm' | 'md' | 'lg' | 'xl'
export type WriteTextIndent = 'none' | 'sm' | 'md'
export type WriteLineHeight = 'tight' | 'normal' | 'relaxed' | 'loose'
export type WriteParagraphSpacing = 'none' | 'sm' | 'md' | 'lg'

export type WriteJumpPosition = 'start' | 'end'
export type WriteAiOutputStyle = 'none' | 'card'

export const WRITE_FONT_FAMILY_STACK: Record<WriteFontFamily, string> = {
    // Sans serif
    sans: 'var(--font-sans)',
    arial: 'Arial, Helvetica, sans-serif',
    helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    // Serif
    serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    times: '"Times New Roman", Times, serif',
    georgia: 'Georgia, "Times New Roman", Times, serif',
    palatino: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
    // Monospace
    mono: 'var(--font-mono)',
    menlo: 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    consolas: 'Consolas, "Liberation Mono", "Courier New", monospace',
    courier: '"Courier New", Courier, monospace',
} as const

export type WriteFormatSettings = {
    fontFamily: WriteFontFamily
    textSize: WriteTextSize
    textIndent: WriteTextIndent
    lineHeight: WriteLineHeight
    paragraphSpacing: WriteParagraphSpacing
    planningStyle: WriteAiOutputStyle
    reasoningStyle: WriteAiOutputStyle
    jumpPosition: WriteJumpPosition
    rememberCursor: boolean
    typewriterMode: boolean
    smoothFollow: boolean
}

const DEFAULT_SETTINGS: WriteFormatSettings = {
    fontFamily: 'sans',
    textSize: 'md',
    textIndent: 'md',
    lineHeight: 'normal',
    paragraphSpacing: 'md',
    planningStyle: 'none',
    reasoningStyle: 'none',
    jumpPosition: 'start',
    rememberCursor: true,
    typewriterMode: false,
    smoothFollow: true,
}

type WriteFormatState = WriteFormatSettings & {
    setFontFamily: (fontFamily: WriteFontFamily) => void
    setTextSize: (textSize: WriteTextSize) => void
    setTextIndent: (textIndent: WriteTextIndent) => void
    setLineHeight: (lineHeight: WriteLineHeight) => void
    setParagraphSpacing: (paragraphSpacing: WriteParagraphSpacing) => void
    setPlanningStyle: (planningStyle: WriteAiOutputStyle) => void
    setReasoningStyle: (reasoningStyle: WriteAiOutputStyle) => void
    setJumpPosition: (jumpPosition: WriteJumpPosition) => void
    setRememberCursor: (rememberCursor: boolean) => void
    setTypewriterMode: (typewriterMode: boolean) => void
    setSmoothFollow: (smoothFollow: boolean) => void
    reset: () => void
}

export const useWriteFormatStore = create<WriteFormatState>()(
    persist(
        (set) => ({
            ...DEFAULT_SETTINGS,
            setFontFamily: (fontFamily) => set({ fontFamily }),
            setTextSize: (textSize) => set({ textSize }),
            setTextIndent: (textIndent) => set({ textIndent }),
            setLineHeight: (lineHeight) => set({ lineHeight }),
            setParagraphSpacing: (paragraphSpacing) => set({ paragraphSpacing }),
            setPlanningStyle: (planningStyle) => set({ planningStyle }),
            setReasoningStyle: (reasoningStyle) => set({ reasoningStyle }),
            setJumpPosition: (jumpPosition) => set({ jumpPosition }),
            setRememberCursor: (rememberCursor) => set({ rememberCursor }),
            setTypewriterMode: (typewriterMode) => set({ typewriterMode }),
            setSmoothFollow: (smoothFollow) => set({ smoothFollow }),
            reset: () => set(DEFAULT_SETTINGS),
        }),
        {
            name: 'onw-write-format',
            partialize: (state) => ({
                fontFamily: state.fontFamily,
                textSize: state.textSize,
                textIndent: state.textIndent,
                lineHeight: state.lineHeight,
                paragraphSpacing: state.paragraphSpacing,
                planningStyle: state.planningStyle,
                reasoningStyle: state.reasoningStyle,
                jumpPosition: state.jumpPosition,
                rememberCursor: state.rememberCursor,
                typewriterMode: state.typewriterMode,
                smoothFollow: state.smoothFollow,
            }),
        }
    )
)
