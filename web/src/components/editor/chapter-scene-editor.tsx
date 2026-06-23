'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { NodeSelection } from 'prosemirror-state'
import type { Editor } from '@tiptap/core'
import { novelApi, promptApi, skillApi, type ChapterWithScenes, type Novel, type NovelLabel, type Prompt, type Scene, type Skill, sceneApi } from '@/lib/api'
import { TipTapEditor } from './tiptap-editor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { htmlToText } from '@/lib/html-to-text'
import { Loader2, MoreVertical, PenLine, Plus, Sparkles, Tag, X } from 'lucide-react'
import type { TermEntry } from '@/components/editor/terms/types'
import { getTermEntryColorClasses, getTermEntryColorId } from '@/components/editor/terms/term-entry-colors'
import { findMentionedTermIds, type TermMentionMatcher } from '@/components/editor/terms/term-mentions-utils'
import { dispatchNovelOutlineDataChanged } from '@/lib/novel-outline-events'
import { TermMentionsHighlightTextarea } from '@/components/editor/terms/term-mentions-highlight-textarea'
import { TermMentionPreviewPopover } from '@/components/editor/terms/term-mention-preview-popover'
import { SceneOperationPromptMenu, type SceneOperationPromptMenuRunSpec } from '@/components/editor/scene-operation-prompt-menu'
import { SceneOperationRunDialog } from '@/components/editor/scene-operation-run-dialog'
import { useEditorCodexStore } from '@/components/editor/editor-codex-store'
import { useInfoPanelStore } from '@/components/editor/info-panel-store'
import { SceneContinuationContextProvider } from '@/components/editor/scene-continuation-context'
import { useSceneEditsStore } from '@/components/editor/scene-edits-store'
import { SceneReviewPanel } from '@/components/editor/manuscript-review'
import { SceneContinuationNode, createSceneContinuationPanelId } from '@/components/editor/scene-continuation-node'
import type { EditorCommandMenuItem } from '@/components/editor/editor-command-menu'
import { ONW_WRITE_JUMP_EVENT, type OnwWriteJumpEventDetail } from '@/components/editor/write-jump-events'
import { getRememberedCursorPosForScene, getRememberedSceneIdForChapter, setSceneCursorMemory } from '@/components/editor/write-cursor-memory'
import { useWriteFormatStore } from '@/components/editor/write-format-store'
import { buildDefaultPromptInputValues, getMissingRequiredPromptInputNames } from '@/lib/prompt-inputs'
import { PROMPTS_CHANGED_EVENT } from '@/lib/prompt-events'
import { sceneHasBodyContent } from '@/lib/manuscript-delete-rules'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ChapterSceneEditorProps {
    novelId?: string
    chapterId: string
    scenes: Scene[]
    onScenesChange: (scenes: Scene[]) => void
    globalChapterIndex: number
    chapterTitle?: string
    termMentionMatcher?: TermMentionMatcher | null
    termEntries: TermEntry[]
    labels: NovelLabel[]
    onManageLabels: () => void
    onOpenRightSidebar?: () => void
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Scene divider component - decorative diamond pattern like NovelCrafter
function SceneDivider() {
    return (
        <div className="flex items-center justify-center py-6 select-none">
            <div className="flex items-center gap-0.5 text-gray-300">
                <span className="text-xs">───────</span>
                <span className="text-xs">◆</span>
                <span className="text-sm">◇</span>
                <span className="text-xs">◆</span>
                <span className="text-xs">───────</span>
            </div>
        </div>
    )
}

export function ChapterSceneEditor({
    novelId,
    chapterId,
    scenes,
    onScenesChange,
    globalChapterIndex,
    chapterTitle,
    termMentionMatcher = null,
    termEntries,
    labels,
    onManageLabels,
    onOpenRightSidebar,
}: ChapterSceneEditorProps) {
    type RunningSceneOperationState = {
        promptId: string
        promptName: string
    }

    type SceneOperationDialogState = {
        sceneId: string
        spec: SceneOperationPromptMenuRunSpec
        open: boolean
        autoRunRequest: { key: number } | null
    }

    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const tPrompts = useTranslations('prompts')
    const tLabels = useTranslations('editor.labels')
    const defaultChapterTitlePattern = useMemo(() => {
        const placeholder = '__NUMBER__'
        const template = t('chapter.defaultTitle', { number: placeholder })
        const escaped = escapeRegex(template).replace(escapeRegex(placeholder), '\\d+')
        return new RegExp(`^${escaped}$`)
    }, [t])
    const isDefaultChapterTitle = useCallback(
        (title: string) => defaultChapterTitlePattern.test(title)
            || /^Chapter\s+\d+$/i.test(title)
            || /^\u7ae0\s*\d+$/.test(title),
        [defaultChapterTitlePattern]
    )
    const chapterLabel = t('chapter.label').toUpperCase()
    const sceneLabel = t('scene.label').toUpperCase()
    const { jumpPosition, rememberCursor, typewriterMode, smoothFollow } = useWriteFormatStore()

    // Track local edits for each scene
    const [localEdits, setLocalEdits] = useState<Record<string, string>>({})
    const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null)
    const [summaryText, setSummaryText] = useState('')
    const saveTimersRef = useRef<Record<string, NodeJS.Timeout>>({})
    const [isCreatingScene, setIsCreatingScene] = useState(false)
    const labelsById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels])
    const termEntriesById = useMemo(() => new Map(termEntries.map((entry) => [entry.id, entry])), [termEntries])
    const [termPickerSceneId, setTermPickerSceneId] = useState<string | null>(null)
    const [termPickerQuery, setTermPickerQuery] = useState('')
    const [mentionPreview, setMentionPreview] = useState<{ termId: string; anchorEl: HTMLElement } | null>(null)
    const sceneEditorByIdRef = useRef<Map<string, Editor>>(new Map())
    const [sceneOperationDialogs, setSceneOperationDialogs] = useState<Record<string, SceneOperationDialogState>>({})
    const [runningSceneOperations, setRunningSceneOperations] = useState<Record<string, RunningSceneOperationState>>({})
    const nextSceneOperationAutoRunKeyRef = useRef(1)
    const scenesRef = useRef(scenes)

    const [continuationSkills, setContinuationSkills] = useState<Skill[]>([])

    useEffect(() => {
        let cancelled = false
        const load = () => {
            void skillApi
                .list({ category: 'scene_continuation' })
                .then((data) => {
                    if (cancelled) return
                    setContinuationSkills((data.skills ?? []).filter((skill) => skill.enabled))
                })
                .catch(() => {
                    if (!cancelled) setContinuationSkills([])
                })
        }
        load()
        window.addEventListener(PROMPTS_CHANGED_EVENT, load)
        return () => {
            cancelled = true
            window.removeEventListener(PROMPTS_CHANGED_EVENT, load)
        }
    }, [])

    const editorCommandMenuItems = useMemo<EditorCommandMenuItem[]>(
        () => [
            {
                id: 'scene_continuation',
                section: 'AI',
                title: tPrompts('categories.sceneContinuation'),
                icon: <PenLine className="h-5 w-5 text-muted-foreground" />,
            },
            ...continuationSkills.map((skill) => ({
                id: `skill:${skill.id}`,
                section: 'Skills',
                title: skill.name,
                description: skill.description || undefined,
                icon: <Sparkles className="h-5 w-5 text-muted-foreground" />,
            })),
        ],
        [continuationSkills, tPrompts]
    )
    const sceneEditorExtraExtensions = useMemo(() => [SceneContinuationNode], [])

    useEffect(() => {
        scenesRef.current = scenes
    }, [scenes])

    const componentPromptsRef = useRef<Prompt[] | null>(null)
    const componentPromptsPromiseRef = useRef<Promise<Prompt[]> | null>(null)

    const novelCacheRef = useRef<(Novel & { chapters: ChapterWithScenes[] }) | null>(null)
    const novelCachePromiseRef = useRef<Promise<Novel & { chapters: ChapterWithScenes[] }> | null>(null)

    useEffect(() => {
        novelCacheRef.current = null
        novelCachePromiseRef.current = null
    }, [novelId])

    useEffect(() => {
        const handlePromptsChanged = () => {
            componentPromptsRef.current = null
            componentPromptsPromiseRef.current = null
        }

        window.addEventListener(PROMPTS_CHANGED_EVENT, handlePromptsChanged)
        return () => window.removeEventListener(PROMPTS_CHANGED_EVENT, handlePromptsChanged)
    }, [])

    const ensureComponentPrompts = useCallback(async () => {
        if (componentPromptsRef.current) return componentPromptsRef.current
        if (componentPromptsPromiseRef.current) return componentPromptsPromiseRef.current

        componentPromptsPromiseRef.current = promptApi
            .list({ category: 'component' })
            .then((data) => data.prompts ?? [])
            .then((prompts) => {
                componentPromptsRef.current = prompts
                componentPromptsPromiseRef.current = null
                return prompts
            })
            .catch((error) => {
                componentPromptsPromiseRef.current = null
                throw error
            })

        return componentPromptsPromiseRef.current
    }, [])

    const ensureNovelData = useCallback(async () => {
        if (!novelId) return null
        if (novelCacheRef.current) return novelCacheRef.current
        if (novelCachePromiseRef.current) return novelCachePromiseRef.current

        novelCachePromiseRef.current = novelApi
            .get(novelId)
            .then((data) => {
                novelCacheRef.current = data
                novelCachePromiseRef.current = null
                return data
            })
            .catch((error) => {
                novelCachePromiseRef.current = null
                throw error
            })

        return novelCachePromiseRef.current
    }, [novelId])

    const jumpToScene = useCallback((sceneId: string) => {
        if (!sceneId) return

        const scrollBlock: ScrollLogicalPosition = jumpPosition === 'end' ? 'end' : 'start'
        const sceneEl = document.getElementById(`scene-${sceneId}`)
        sceneEl?.scrollIntoView({ behavior: 'smooth', block: scrollBlock })

        const fallbackFocus: 'start' | 'end' = jumpPosition === 'end' ? 'end' : 'start'
        const rememberedPos = rememberCursor && novelId ? getRememberedCursorPosForScene(novelId, sceneId) : null
        const focusTarget: 'start' | 'end' | number = rememberedPos ?? fallbackFocus

        let attempts = 0
        const tryFocus = () => {
            const editor = sceneEditorByIdRef.current.get(sceneId) ?? null
            if (!editor) {
                attempts += 1
                if (attempts < 40) window.requestAnimationFrame(tryFocus)
                return
            }

            if (typeof focusTarget === 'number') {
                const maxPos = editor.state.doc.content.size
                const safePos = Math.max(1, Math.min(focusTarget, maxPos))
                editor.commands.focus(safePos)
            } else {
                editor.commands.focus(focusTarget)
            }
        }

        window.requestAnimationFrame(tryFocus)
    }, [jumpPosition, novelId, rememberCursor])

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<OnwWriteJumpEventDetail>).detail
            if (!detail?.chapterId) return
            if (detail.chapterId !== chapterId) return
            if (!scenes || scenes.length === 0) {
                document.getElementById(`chapter-${chapterId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                return
            }

            let targetSceneId: string | null = null
            if (rememberCursor && novelId) {
                const rememberedScene = getRememberedSceneIdForChapter(novelId, chapterId)
                if (rememberedScene && scenes.some((scene) => scene.id === rememberedScene)) {
                    targetSceneId = rememberedScene
                }
            }

            if (!targetSceneId) {
                targetSceneId = jumpPosition === 'end'
                    ? scenes[scenes.length - 1]?.id ?? null
                    : scenes[0]?.id ?? null
            }

            if (!targetSceneId) return
            jumpToScene(targetSceneId)
        }

        window.addEventListener(ONW_WRITE_JUMP_EVENT, handler as EventListener)
        return () => window.removeEventListener(ONW_WRITE_JUMP_EVENT, handler as EventListener)
    }, [chapterId, jumpPosition, jumpToScene, novelId, rememberCursor, scenes])

    const termPickerResults = useMemo(() => {

        const normalizedQuery = termPickerQuery.trim().toLocaleLowerCase()
        const base = termEntries.filter((entry) => !entry.archived)
        const filtered = normalizedQuery
            ? base.filter((entry) => {
                const title = entry.title?.toLocaleLowerCase() ?? ''
                const aliases = entry.aliases?.toLocaleLowerCase() ?? ''
                return title.includes(normalizedQuery) || aliases.includes(normalizedQuery)
            })
            : base

        return filtered.slice().sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    }, [termEntries, termPickerQuery])

    const handleTermMentionClick = useCallback((termId: string, anchorEl: HTMLElement) => {
        setMentionPreview((prev) => {
            if (prev?.termId === termId && prev.anchorEl === anchorEl) return null
            return { termId, anchorEl }
        })
    }, [])

    const mentionPreviewEntry = useMemo(() => {
        if (!mentionPreview) return null
        return termEntriesById.get(mentionPreview.termId) ?? null
    }, [mentionPreview, termEntriesById])

    // Save scene content to API
    const saveSceneContent = useCallback(async (sceneId: string, content: string) => {
        try {
            const updated = await sceneApi.update(sceneId, { content })
            onScenesChange(scenes.map(s =>
                s.id === sceneId ? { ...s, content, wordCount: updated.wordCount } : s
            ))
        } catch (error) {
            console.error('Failed to save scene:', error)
        }
    }, [scenes, onScenesChange])

    // Save scene summary
    const saveSceneSummary = useCallback(async (sceneId: string, summary: string) => {
        try {
            await sceneApi.update(sceneId, { summary })
            if (novelId) dispatchNovelOutlineDataChanged({ novelId })
        } catch (error) {
            console.error('Failed to save summary:', error)
        }
    }, [novelId])

    // Save scene labels
    const saveSceneLabels = useCallback(async (sceneId: string, labelIds: string[]) => {
        try {
            const updated = await sceneApi.update(sceneId, { labelIds })
            onScenesChange(scenes.map(s =>
                s.id === sceneId ? { ...s, labelIds: updated.labelIds } : s
            ))
        } catch (error) {
            console.error('Failed to save labels:', error)
        }
    }, [scenes, onScenesChange])

    const saveSceneTerms = useCallback(async (sceneId: string, termIds: string[]) => {
        try {
            const updated = await sceneApi.update(sceneId, { termIds })
            onScenesChange(scenes.map(s =>
                s.id === sceneId ? { ...s, termIds: updated.termIds } : s
            ))
        } catch (error) {
            console.error('Failed to save terms:', error)
        }
    }, [scenes, onScenesChange])

    const copySceneToClipboard = useCallback(async (value: string) => {
        const text = value.trimEnd()
        if (!text.trim()) return
        try {
            await navigator.clipboard.writeText(text)
        } catch (error) {
            console.error('Failed to copy scene:', error)
        }
    }, [])

    const completeSceneOperation = useCallback(async (sceneId: string, text: string) => {
        const nextSummary = text.trim()
        if (!nextSummary) return

        const latestScenes = scenesRef.current
        if (!latestScenes.some((scene) => scene.id === sceneId)) return

        onScenesChange(latestScenes.map((scene) => (scene.id === sceneId ? { ...scene, summary: nextSummary } : scene)))
        if (editingSummaryId === sceneId) {
            setSummaryText(nextSummary)
        }
        await sceneApi.update(sceneId, { summary: nextSummary })
        if (novelId) dispatchNovelOutlineDataChanged({ novelId })
    }, [editingSummaryId, novelId, onScenesChange])

    const handleSceneOperationSkillRun = useCallback(
        (sceneId: string, sceneIndex: number, skill: Skill) => {
            const sceneRefLabel = `${getChapterTitleDisplay()} · ${sceneLabel} ${sceneIndex + 1}`
            const sceneRef = `[${sceneRefLabel}](scene:${chapterId}:${sceneId})`
            const draftContent = `[${skill.name}](skill:${skill.id})\n\n${sceneRef}`
            useInfoPanelStore.getState().setActiveTab('codex')
            void useEditorCodexStore
                .getState()
                .createSceneOperationSkillSession(novelId, {
                    skillId: skill.id,
                    sceneId,
                    draftContent,
                    title: `${skill.name} · ${sceneRefLabel}`,
                })
                .catch((error) => {
                    console.error('Failed to start scene-operation skill session:', error)
                })
        },
        // getChapterTitleDisplay/sceneLabel are derived from chapterTitle/globalChapterIndex props.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [chapterId, novelId, sceneLabel, chapterTitle, globalChapterIndex]
    )

    const setSceneOperationDialogOpen = useCallback(
        (
            sceneId: string,
            spec: SceneOperationPromptMenuRunSpec,
            open: boolean,
            autoRunRequest: SceneOperationDialogState['autoRunRequest'] = null
        ) => {
            setSceneOperationDialogs((current) => ({
                ...current,
                [sceneId]: {
                    sceneId,
                    spec,
                    open,
                    autoRunRequest,
                },
            }))
        },
        []
    )

    const clearSceneOperationDialog = useCallback((sceneId: string) => {
        setSceneOperationDialogs((current) => {
            if (!(sceneId in current)) return current
            const next = { ...current }
            delete next[sceneId]
            return next
        })
    }, [])

    const handleSceneOperationRunningChange = useCallback(
        (sceneId: string, spec: SceneOperationPromptMenuRunSpec, running: boolean) => {
            setRunningSceneOperations((current) => {
                if (running) {
                    const existing = current[sceneId]
                    if (existing && existing.promptId === spec.prompt.id && existing.promptName === spec.prompt.name) {
                        return current
                    }
                    return {
                        ...current,
                        [sceneId]: {
                            promptId: spec.prompt.id,
                            promptName: spec.prompt.name,
                        },
                    }
                }

                if (!(sceneId in current)) return current
                const next = { ...current }
                delete next[sceneId]
                return next
            })
        },
        []
    )

    const handleSceneOperationRun = useCallback(
        (sceneId: string, spec: SceneOperationPromptMenuRunSpec) => {
            const existingDialog = sceneOperationDialogs[sceneId]
            if (existingDialog && existingDialog.spec.prompt.id === spec.prompt.id) {
                setSceneOperationDialogOpen(sceneId, spec, true, null)
                return
            }

            const inputs = spec.prompt.inputs ?? []
            const inputValues = buildDefaultPromptInputValues(inputs)
            const missingRequiredInputNames = getMissingRequiredPromptInputNames(inputs, inputValues)

            if (missingRequiredInputNames.length > 0) {
                setSceneOperationDialogOpen(sceneId, spec, true, null)
                return
            }

            setSceneOperationDialogOpen(sceneId, spec, false, {
                key: nextSceneOperationAutoRunKeyRef.current++,
            })
        },
        [sceneOperationDialogs, setSceneOperationDialogOpen]
    )

    // Delete scene
    const handleDeleteScene = useCallback(async (sceneId: string) => {
        if (scenes.length <= 1) return // Don't delete last scene
        // Cancel any pending debounced content save so it doesn't fire after
        // the scene is gone and hit the API with a stale "Scene not found".
        if (saveTimersRef.current[sceneId]) {
            clearTimeout(saveTimersRef.current[sceneId])
            delete saveTimersRef.current[sceneId]
        }
        try {
            await sceneApi.delete(sceneId)
            onScenesChange(scenes.filter(s => s.id !== sceneId))
            setLocalEdits(prev => {
                if (!(sceneId in prev)) return prev
                const next = { ...prev }
                delete next[sceneId]
                return next
            })
        } catch (error) {
            console.error('Failed to delete scene:', error)
        }
    }, [scenes, onScenesChange])

    // Handle content change with debounced auto-save
    const handleContentChange = useCallback((sceneId: string, content: string) => {
        setLocalEdits(prev => ({ ...prev, [sceneId]: content }))

        if (novelId) {
            const editor = sceneEditorByIdRef.current.get(sceneId) ?? null
            setSceneCursorMemory({
                novelId,
                chapterId,
                sceneId,
                cursorPos: editor?.state.selection.from ?? 1,
            })
        }

        if (saveTimersRef.current[sceneId]) {
            clearTimeout(saveTimersRef.current[sceneId])
        }

        saveTimersRef.current[sceneId] = setTimeout(() => {
            saveSceneContent(sceneId, content)
        }, 2000)
    }, [chapterId, novelId, saveSceneContent])

    // Create new scene
    const handleCreateScene = useCallback(async () => {
        if (isCreatingScene) return
        setIsCreatingScene(true)

        try {
            const newScene = await sceneApi.create(chapterId)
            setLocalEdits(prev => ({ ...prev, [newScene.id]: '' }))
            onScenesChange([...scenes, newScene])
        } catch (error) {
            console.error('Failed to create scene:', error)
        } finally {
            setIsCreatingScene(false)
        }
    }, [chapterId, scenes, onScenesChange, isCreatingScene])

    // Get content for a scene (local edit or original)
    const getSceneContent = (scene: Scene) => {
        return localEdits[scene.id] ?? scene.content
    }

    // Scenes in this chapter that have pending Codex edits awaiting review.
    const pendingSceneEdits = useSceneEditsStore((state) => state.edits)
    const scenesWithPendingEdits = useMemo(
        () => new Set(pendingSceneEdits.map((edit) => edit.sceneId)),
        [pendingSceneEdits]
    )

    // Build the chapter title display
    const getChapterTitleDisplay = () => {
        if (chapterTitle && !isDefaultChapterTitle(chapterTitle)) {
            return `${chapterLabel} ${globalChapterIndex}: ${chapterTitle}`
        }
        return `${chapterLabel} ${globalChapterIndex}`
    }

    // If no scenes, show loading state
    if (scenes.length === 0) {
        return (
            <div className="text-muted-foreground italic">
                {t('scene.loadingScenes')}
            </div>
        )
    }

    return (
        <div className="space-y-0">
            {scenes.map((scene, index) => {
                const manualIds = scene.termIds ?? []
                const manualSet = new Set(manualIds)
                const contentText = htmlToText(getSceneContent(scene), { paragraphSeparator: '\n' })
                const clipboardText = contentText
                const effectiveSummary = editingSummaryId === scene.id ? summaryText : (scene.summary || '')
                const activeSceneOperation = runningSceneOperations[scene.id] ?? null
                const activeSceneOperationDialog = sceneOperationDialogs[scene.id] ?? null
                const detectedSet = findMentionedTermIds(`${contentText}\n${effectiveSummary}`, termMentionMatcher)
                const canDeleteSceneDirectly = !sceneHasBodyContent({ content: getSceneContent(scene) })

                const merged = new Set<string>([...manualIds, ...detectedSet])
                const usedTermEntries = [...merged]
                    .map((id) => termEntriesById.get(id))
                    .filter(Boolean) as TermEntry[]
                usedTermEntries.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))

                return (
                    <div key={scene.id} id={`scene-${scene.id}`} data-scene-id={scene.id}>
                    {/* Scene divider between scenes */}
                    {index > 0 && <SceneDivider />}

                    {/* Scene row: Editor (left) + Info Panel (right) */}
                    <div
                        className={cn(
                            'flex gap-4 pr-1',
                            scenesWithPendingEdits.has(scene.id) && 'rounded-lg border-l-2 border-emerald-500/60 pl-1'
                        )}
                    >
                        {/* Left: Scene editor */}
                        <div className="flex-1 min-w-0 pl-1">
                            {novelId && <SceneReviewPanel novelId={novelId} sceneId={scene.id} />}
                            <SceneContinuationContextProvider
                                value={{
                                    novelId,
                                    chapterId,
                                    chapterTitle,
                                    sceneId: scene.id,
                                    scenes,
                                    localEdits,
                                    ensureComponentPrompts,
                                    ensureNovelData,
                                    termMentionMatcher,
                                    termEntries,
                                    onOpenRightSidebar,
                                }}
                            >
                                <TipTapEditor
                                    content={getSceneContent(scene)}
                                    onChange={(content) => handleContentChange(scene.id, content)}
                                    placeholder={index === 0 ? t('scene.startWriting') : t('scene.continueWriting')}
                                    termMentionMatcher={termMentionMatcher}
                                    onTermMentionClick={handleTermMentionClick}
                                    extraExtensions={sceneEditorExtraExtensions}
                                    onEditorReady={(editor) => {
                                        const map = sceneEditorByIdRef.current
                                        if (editor) {
                                            map.set(scene.id, editor)
                                        } else {
                                            map.delete(scene.id)
                                        }
                                    }}
                                    onSelectionUpdate={(editor) => {
                                        if (!novelId) return
                                        if (!editor.isFocused) return
                                        setSceneCursorMemory({
                                            novelId,
                                            chapterId,
                                            sceneId: scene.id,
                                            cursorPos: editor.state.selection.from,
                                        })
                                    }}
                                    typewriter={{
                                        enabled: typewriterMode,
                                        smooth: smoothFollow,
                                    }}
                                    commandMenu={{
                                        items: editorCommandMenuItems,
                                        onSelect: (commandId, editor) => {
                                            const skillId = commandId.startsWith('skill:') ? commandId.slice('skill:'.length) : ''
                                            if (commandId !== 'scene_continuation' && !skillId) return

                                            editor
                                                .chain()
                                                .focus()
                                                .insertContent({
                                                    type: 'sceneContinuation',
                                                    attrs: {
                                                        panelId: createSceneContinuationPanelId(),
                                                        ...(skillId ? { skillId } : {}),
                                                    },
                                                })
                                                .run()

                                            const selection = editor.state.selection
                                            if (
                                                selection instanceof NodeSelection &&
                                                selection.node.type.name === 'sceneContinuation'
                                            ) {
                                                const nodeAfter = selection.$to.nodeAfter
                                                if (nodeAfter?.isTextblock) {
                                                    editor.commands.setTextSelection(selection.to + 1)
                                                } else {
                                                    editor.commands.createParagraphNear()
                                                }
                                            }
                                        },
                                        triggerKeys: ['tab'],
                                    }}
                                />
                            </SceneContinuationContextProvider>
                        </div>

                        {/* Right: Scene info panel - with group hover effect */}
                        <div className="w-60 shrink-0 text-xs space-y-2 pt-1 group text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                            {/* Scene title and word count */}
                            <div className="font-medium group-hover:text-foreground transition-colors">
                                {getChapterTitleDisplay()} - {sceneLabel} {index + 1}
                                <span className="font-normal ml-2">
                                    – {scene.wordCount} {scene.wordCount === 1 ? tCommon('word') : tCommon('words')}
                                </span>
                            </div>

                            {/* Summary */}
                            <TermMentionsHighlightTextarea
                                id={`scene-summary-${scene.id}`}
                                data-scene-summary-id={scene.id}
                                value={editingSummaryId === scene.id ? summaryText : (scene.summary || '')}
                                onTermMentionClick={handleTermMentionClick}
                                onChange={(e) => {
                                    if (editingSummaryId === scene.id) {
                                        setSummaryText(e.target.value)
                                    }
                                }}
                                onFocus={() => {
                                    setEditingSummaryId(scene.id)
                                    setSummaryText(scene.summary || '')
                                }}
                                onBlur={() => {
                                    if (editingSummaryId === scene.id) {
                                        const nextSummary = summaryText
                                        onScenesChange(scenes.map(s =>
                                            s.id === scene.id ? { ...s, summary: nextSummary } : s
                                        ))
                                        setEditingSummaryId(null)
                                        saveSceneSummary(scene.id, nextSummary)
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault()
                                        const nextSummary = summaryText
                                        onScenesChange(scenes.map(s =>
                                            s.id === scene.id ? { ...s, summary: nextSummary } : s
                                        ))
                                        setEditingSummaryId(null)
                                        saveSceneSummary(scene.id, nextSummary)
                                            ; (e.target as HTMLTextAreaElement).blur()
                                    }
                                    if (e.key === 'Escape') {
                                        setEditingSummaryId(null)
                                            ; (e.target as HTMLTextAreaElement).blur()
                                    }
                                }}
                                placeholder={t('scene.addSummary')}
                                matcher={termMentionMatcher}
                                containerClassName={`rounded transition-colors ${editingSummaryId === scene.id ? 'bg-gray-50/50 text-foreground' : 'group-hover:bg-muted/30'}`}
                                className="w-full text-xs border-transparent rounded px-2 py-1 resize-none outline-none cursor-text placeholder:text-muted-foreground/60"
                                rows={2}
                            />

                            {/* Labels */}
                            {scene.labelIds.length > 0 && (
                                <div className="flex flex-wrap gap-1 px-1">
                                    {scene.labelIds
                                        .map((labelId) => labelsById.get(labelId))
                                        .filter(Boolean)
                                        .map((label) => (
                                            <Badge
                                                key={label!.id}
                                                className="text-white border pr-1 gap-1 hover:opacity-90 transition-opacity"
                                                style={{
                                                    backgroundColor: label!.color ?? '#000000',
                                                    borderColor: label!.color ?? '#000000',
                                                }}
                                            >
                                                <span className="leading-none">{label!.name}</span>
                                                <button
                                                    type="button"
                                                    className="rounded-full p-0.5 hover:bg-white/20"
                                                    onClick={() => saveSceneLabels(scene.id, scene.labelIds.filter((id) => id !== label!.id))}
                                                    aria-label={tCommon('delete')}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                </div>
                            )}

                            {usedTermEntries.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-dashed border-muted-foreground/30">
                                    <div className="flex flex-wrap gap-1 px-1">
                                        {usedTermEntries.map((entry) => {
                                            const colorId = getTermEntryColorId(entry.color)
                                            const colorClasses = getTermEntryColorClasses(colorId)
                                            const hasCustomColor = colorId !== 'black'
                                            const isManual = manualSet.has(entry.id)
                                            const isDetected = detectedSet.has(entry.id)

                                            return (
                                                <Badge
                                                    key={entry.id}
                                                    variant="outline"
                                                    className={cn(
                                                        'pr-1 gap-1 font-medium',
                                                        colorClasses.subtleBg,
                                                        colorClasses.subtleBorder,
                                                        entry.archived && 'opacity-60'
                                                    )}
                                                >
                                                    <span className={cn('leading-none', hasCustomColor && colorClasses.text)}>
                                                        {entry.title}
                                                    </span>
                                                    {isManual && !isDetected && (
                                                        <button
                                                            type="button"
                                                            className="rounded-full p-0.5 hover:bg-foreground/10"
                                                            onClick={() => saveSceneTerms(scene.id, manualIds.filter((id) => id !== entry.id))}
                                                            aria-label={tCommon('delete')}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    )}
                                                </Badge>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            {activeSceneOperation && (
                                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] text-foreground/80">
                                    <button
                                        type="button"
                                        className="min-w-0 flex flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
                                        disabled={!activeSceneOperationDialog}
                                        onClick={() => {
                                            if (!activeSceneOperationDialog) return
                                            setSceneOperationDialogOpen(scene.id, activeSceneOperationDialog.spec, true, null)
                                        }}
                                    >
                                        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                                        <span className="truncate">
                                            {t('scene.operationRunning', { name: activeSceneOperation.promptName })}
                                        </span>
                                    </button>
                                </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex items-center gap-4">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button className="flex items-center gap-1 group-hover:hover:text-foreground px-2 py-1 rounded focus:outline-none data-[state=open]:bg-black data-[state=open]:text-white">
                                            <MoreVertical className="h-3 w-3" />
                                            {t('actions.label')}
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                        <DropdownMenuItem
                                            disabled={!clipboardText.trim()}
                                            onClick={() => void copySceneToClipboard(clipboardText)}
                                        >
                                            {t('scene.copyScene')}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <SceneOperationPromptMenu
                                            onRun={(spec) => handleSceneOperationRun(scene.id, spec)}
                                            onRunSkill={(skill) => handleSceneOperationSkillRun(scene.id, index, skill)}
                                        />
                                        {scenes.length > 1 && (
                                            <>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    variant={canDeleteSceneDirectly ? 'destructive' : 'default'}
                                                    className={canDeleteSceneDirectly ? 'text-destructive' : 'text-muted-foreground'}
                                                    disabled={!canDeleteSceneDirectly}
                                                    onClick={() => {
                                                        if (canDeleteSceneDirectly) {
                                                            handleDeleteScene(scene.id)
                                                        }
                                                    }}
                                                >
                                                    {t('scene.deleteScene')}
                                                </DropdownMenuItem>
                                            </>
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button className="flex items-center gap-1 group-hover:hover:text-foreground px-2 py-1 rounded focus:outline-none data-[state=open]:bg-black data-[state=open]:text-white">
                                            <Tag className="h-3 w-3" />
                                            {t('actions.labelBtn')}
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="min-w-[14rem]">
                                        <DropdownMenuItem onClick={onManageLabels}>{tLabels('manage')}</DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        {labels.length === 0 ? (
                                            <DropdownMenuItem disabled>{tLabels('empty')}</DropdownMenuItem>
                                        ) : (
                                            labels
                                                .slice()
                                                .sort((a, b) => a.sortOrder - b.sortOrder)
                                                .map((label) => (
                                                    <DropdownMenuCheckboxItem
                                                        key={label.id}
                                                        checked={scene.labelIds.includes(label.id)}
                                                        onCheckedChange={(checked) => {
                                                            const isChecked = checked === true
                                                            const next = isChecked
                                                                ? [...scene.labelIds, label.id]
                                                                : scene.labelIds.filter((id) => id !== label.id)
                                                            saveSceneLabels(scene.id, next)
                                                        }}
                                                        onSelect={(e) => e.preventDefault()}
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <span
                                                                className="inline-block h-3 w-3 rounded-sm border"
                                                                style={{
                                                                    backgroundColor: label.color ?? '#000000',
                                                                    borderColor: label.color ?? '#000000',
                                                                }}
                                                            />
                                                            {label.name}
                                                        </span>
                                                    </DropdownMenuCheckboxItem>
                                                ))
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <DropdownMenu
                                    open={termPickerSceneId === scene.id}
                                    onOpenChange={(open) => {
                                        setTermPickerSceneId(open ? scene.id : null)
                                        if (open) setTermPickerQuery('')
                                    }}
                                >
                                    <DropdownMenuTrigger asChild>
                                        <button className="flex items-center gap-1 group-hover:hover:text-foreground px-2 py-1 rounded focus:outline-none data-[state=open]:bg-black data-[state=open]:text-white">
                                            <Plus className="h-3 w-3" />
                                            {t('actions.term')}
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="min-w-[16rem] p-0">
                                        <div className="p-2">
                                            <Input
                                                value={termPickerQuery}
                                                onChange={(e) => setTermPickerQuery(e.target.value)}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                placeholder={t('terms.search')}
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                        <DropdownMenuSeparator />

                                        {termPickerResults.length === 0 ? (
                                            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                                {t('terms.emptyAll')}
                                            </DropdownMenuItem>
                                        ) : (
                                            termPickerResults.map((entry) => {
                                                const alreadyAdded = manualSet.has(entry.id)
                                                const detected = detectedSet.has(entry.id)

                                                const colorId = getTermEntryColorId(entry.color)
                                                const colorClasses = getTermEntryColorClasses(colorId)
                                                const hasCustomColor = colorId !== 'black'

                                                return (
                                                    <DropdownMenuItem
                                                        key={entry.id}
                                                        disabled={alreadyAdded || detected}
                                                        onSelect={(e) => {
                                                            e.preventDefault()
                                                            if (alreadyAdded || detected) return
                                                            saveSceneTerms(scene.id, [...manualIds, entry.id])
                                                        }}
                                                    >
                                                        <span className="flex items-center gap-2 min-w-0">
                                                            <span className={cn('h-2 w-2 rounded-full', colorClasses.dot)} aria-hidden="true" />
                                                            <span className={cn('truncate', hasCustomColor && colorClasses.text)}>{entry.title}</span>
                                                        </span>
                                                    </DropdownMenuItem>
                                                )
                                            })
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                    </div>
                </div>
                )
            })}

            {/* New Scene button */}
            <div className="my-8 flex items-center justify-start gap-4">
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground gap-1"
                    onClick={handleCreateScene}
                    disabled={isCreatingScene}
                >
                    <Plus className="h-3 w-3" />
                    {isCreatingScene ? t('scene.creating') : t('scene.newScene')}
                </Button>
            </div>

            <TermMentionPreviewPopover
                novelId={novelId}
                open={Boolean(mentionPreviewEntry && mentionPreview)}
                anchorEl={mentionPreview?.anchorEl ?? null}
                entry={mentionPreviewEntry}
                onClose={() => setMentionPreview(null)}
            />

            {Object.values(sceneOperationDialogs).map((sceneOperationDialog) => (
                <SceneOperationRunDialog
                    key={`${sceneOperationDialog.sceneId}:${sceneOperationDialog.spec.prompt.id}`}
                    open={sceneOperationDialog.open}
                    onOpenChange={(open, options) => {
                        if (open) {
                            setSceneOperationDialogOpen(sceneOperationDialog.sceneId, sceneOperationDialog.spec, true, null)
                            return
                        }

                        if (options?.preserveState) {
                            setSceneOperationDialogOpen(sceneOperationDialog.sceneId, sceneOperationDialog.spec, false, null)
                            return
                        }

                        clearSceneOperationDialog(sceneOperationDialog.sceneId)
                    }}
                    novelId={novelId}
                    chapterId={chapterId}
                    chapterTitle={chapterTitle}
                    sceneId={sceneOperationDialog.sceneId}
                    scenes={scenes}
                    localEdits={localEdits}
                    spec={sceneOperationDialog.spec}
                    onComplete={(text) => completeSceneOperation(sceneOperationDialog.sceneId, text)}
                    onRunningChange={(running) =>
                        handleSceneOperationRunningChange(sceneOperationDialog.sceneId, sceneOperationDialog.spec, running)
                    }
                    autoRunRequest={sceneOperationDialog.autoRunRequest}
                />
            ))}
        </div>
    )
}
