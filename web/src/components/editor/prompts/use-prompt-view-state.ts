'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
    DEFAULT_EXPANDED_CATEGORIES,
    coerceCategory,
    coercePromptEditorTab,
    normalizeEditorTabForCategory,
    type PersistedPromptViewState,
    type PromptEditorTab,
} from '@/components/editor/prompts/middle-panel-prompts-shared'
import type { PromptCategory } from '@/lib/prompts'

export function usePromptViewState(novelId?: string) {
    const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
    const [activeCategory, setActiveCategory] = useState<PromptCategory>('scene_continuation')
    const [expandedCategories, setExpandedCategories] = useState<Record<PromptCategory, boolean>>(DEFAULT_EXPANDED_CATEGORIES)
    const [searchQuery, setSearchQuery] = useState('')
    const [editorTab, setEditorTab] = useState<PromptEditorTab>('instructions')

    const hasRestoredViewStateRef = useRef(false)
    const hasInitializedViewStatePersistenceRef = useRef(false)
    const promptViewStateKey = useMemo(() => `editor_prompt_view_state_${novelId ?? 'global'}`, [novelId])

    const persistPromptViewState = useCallback((overrides?: Partial<PersistedPromptViewState>) => {
        if (typeof window === 'undefined') return
        if (!hasRestoredViewStateRef.current) return

        const stateToStore: PersistedPromptViewState = {
            selectedPromptId,
            activeCategory,
            editorTab,
            expandedCategories,
            ...overrides,
        }
        localStorage.setItem(promptViewStateKey, JSON.stringify(stateToStore))
    }, [activeCategory, editorTab, expandedCategories, promptViewStateKey, selectedPromptId])

    useEffect(() => {
        if (typeof window === 'undefined') return
        if (hasRestoredViewStateRef.current) return

        const rawState = localStorage.getItem(promptViewStateKey)
        if (rawState) {
            try {
                const parsed = JSON.parse(rawState) as PersistedPromptViewState
                const restoredCategory = coerceCategory(parsed.activeCategory ?? '')
                const restoredTab = coercePromptEditorTab(parsed.editorTab)

                startTransition(() => {
                    if (restoredCategory && restoredCategory !== 'default') setActiveCategory(restoredCategory)
                    if (typeof parsed.selectedPromptId === 'string' && parsed.selectedPromptId.trim()) {
                        setSelectedPromptId(parsed.selectedPromptId)
                    }
                    if (restoredTab) {
                        setEditorTab(normalizeEditorTabForCategory(restoredTab, restoredCategory))
                    }
                    if (parsed.expandedCategories && typeof parsed.expandedCategories === 'object') {
                        setExpandedCategories((prev) => {
                            const next = { ...prev }
                            for (const [rawCategory, value] of Object.entries(parsed.expandedCategories ?? {})) {
                                const category = coerceCategory(rawCategory)
                                if (!category || typeof value !== 'boolean') continue
                                next[category] = value
                            }
                            return next
                        })
                    }
                })
            } catch {
                // Ignore invalid persisted state.
            }
        }

        hasRestoredViewStateRef.current = true
    }, [promptViewStateKey])

    useEffect(() => {
        if (!hasRestoredViewStateRef.current) return
        if (!hasInitializedViewStatePersistenceRef.current) {
            hasInitializedViewStatePersistenceRef.current = true
            return
        }
        persistPromptViewState()
    }, [persistPromptViewState])

    const toggleCategory = useCallback((category: PromptCategory) => {
        setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }))
    }, [])

    return {
        selectedPromptId,
        setSelectedPromptId,
        activeCategory,
        setActiveCategory,
        expandedCategories,
        setExpandedCategories,
        searchQuery,
        setSearchQuery,
        editorTab,
        setEditorTab,
        toggleCategory,
    }
}
