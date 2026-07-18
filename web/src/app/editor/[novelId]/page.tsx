'use client'

import Image from 'next/image'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useAuthStore } from '@/lib/store'
import { actApi, chapterApi, ChapterWithScenes, labelApi, Novel, NovelLabel, novelApi, Scene } from '@/lib/api'
import {
    NOVEL_REFRESH_REQUESTED_EVENT,
    type NovelRefreshRequestedEventDetail,
} from '@/lib/novel-refresh-events'
import { dispatchNovelOutlineDataChanged } from '@/lib/novel-outline-events'
import { createActChapterActions } from './act-chapter-actions'
import { NovelSettingsDialog } from '@/components/editor/novel-settings-dialog'
import { MiddlePanelMenu } from '@/components/editor/middle-panel-menu'
import { MiddlePanelWrite } from '@/components/editor/middle-panel-write'
import { MiddlePanelPrompts } from '@/components/editor/middle-panel-prompts'
import { MiddlePanelSkills } from '@/components/editor/skills/middle-panel-skills'
import { MiddlePanelAgents } from '@/components/editor/agents/middle-panel-agents'
import { MiddlePanelReview } from '@/components/editor/middle-panel-review'
import { WriteFormatMenu } from '@/components/editor/write-format-menu'
import { LeftPanelMenu } from '@/components/editor/left-panel-menu'
import { RightPanel } from '@/components/editor/right-panel'
import { ChapterScrollbarMarks } from '@/components/editor/chapter-scrollbar-marks'
import { useInfoPanelStore } from '@/components/editor/info-panel-store'
import { useSceneEditsStore } from '@/components/editor/scene-edits-store'
import { ManuscriptReviewToolbar } from '@/components/editor/manuscript-review'
import { SCENE_EDITS_CHANGED_EVENT } from '@/components/editor/scene-edit-events'
import { OPEN_TERM_ENTRY_EVENT, type OpenTermEntryEventDetail, type TermEntryPanelTab } from '@/components/editor/terms/term-entry-events'
import { dispatchWriteJump } from '@/components/editor/write-jump-events'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import {
    ChevronLeft,
    ChevronDown,
    BookOpen,
    Check,
    Maximize2,
    PanelLeftClose,
    PanelRightClose,
    Edit3,
    ClipboardList,
    Settings,
    BookMarked,
    Sparkles,
    Bot,
} from 'lucide-react'

// View filter enum
type ViewFilter = 'everything' | 'act' | 'chapter'

// Nav tab type
type NavTab = 'menu' | 'write' | 'prompts' | 'skills' | 'agents' | 'review'

type RequestedOutlineTarget =
    | { kind: 'act'; actNumber: number }
    | { kind: 'chapter'; chapterId: string }

type RequestedTermEntry = {
    entryId: string
    tab?: TermEntryPanelTab
}

type PersistedEditorViewState = {
    activeTab?: NavTab
    viewFilter?: ViewFilter
    selectedActNumber?: number | null
    selectedChapterId?: string | null
    lastChapterId?: string | null
    writeScrollTop?: number | null
    focusMode?: boolean
}

interface EditorPageProps {
    params: Promise<{ novelId: string }>
}

export default function EditorPage({ params }: EditorPageProps) {
    const router = useRouter()
    const { token, isHydrated } = useAuthStore()
    const t = useTranslations('editor')
    const tCommon = useTranslations('common')
    const setInfoPanelActiveTab = useInfoPanelStore((state) => state.setActiveTab)
    const escapeRegex = useCallback((value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), [])
    const getDefaultTitlePattern = useCallback((template: string) => {
        const placeholder = '__NUMBER__'
        const escaped = escapeRegex(template)
        return new RegExp(`^${escaped.replace(escapeRegex(placeholder), '\\d+')}$`)
    }, [escapeRegex])
    const defaultChapterTitlePattern = useMemo(
        () => getDefaultTitlePattern(t('chapter.defaultTitle', { number: '__NUMBER__' })),
        [getDefaultTitlePattern, t]
    )
    const defaultActTitlePattern = useMemo(
        () => getDefaultTitlePattern(t('act.defaultTitle', { number: '__NUMBER__' })),
        [getDefaultTitlePattern, t]
    )
    const getDefaultChapterTitle = useCallback(
        (chapterNumber: number) => t('chapter.defaultTitle', { number: chapterNumber }),
        [t]
    )
    const getDefaultActTitle = useCallback(
        (actNumber: number) => t('act.defaultTitle', { number: actNumber }),
        [t]
    )
    const isDefaultChapterTitle = useCallback(
        (title: string) => defaultChapterTitlePattern.test(title)
            || /^Chapter\s+\d+$/i.test(title)
            || /^\u7ae0\s*\d+$/.test(title),
        [defaultChapterTitlePattern]
    )
    const isDefaultActTitleText = useCallback(
        (title: string) => defaultActTitlePattern.test(title)
            || /^Act\s+\d+$/i.test(title)
            || /^\u5377\s*\d+$/.test(title),
        [defaultActTitlePattern]
    )

    // Core state
    const [novelId, setNovelId] = useState<string | null>(null)
    const [novel, setNovel] = useState<Novel | null>(null)
    const [chapters, setChapters] = useState<ChapterWithScenes[]>([])
    const [loading, setLoading] = useState(true)
    const [lastVisibleChapterId, setLastVisibleChapterId] = useState<string | null>(null)

    // UI state
    const [activeTab, setActiveTab] = useState<NavTab>('write')
    const [sidebarOpen, setSidebarOpen] = useState(true)
    const [sidebarWidth, setSidebarWidth] = useState(272) // Keep labels visible while freeing more space for the editor and right panel
    const [focusMode, setFocusMode] = useState(false)
    const [sidebarTab, setSidebarTab] = useState<'outline' | 'codex' | 'chapterOutline' | 'term' | 'snippets' | 'chats'>('outline')
    const [requestedOpenSnippetId, setRequestedOpenSnippetId] = useState<string | null>(null)
    const [requestedOpenOutlineTarget, setRequestedOpenOutlineTarget] = useState<RequestedOutlineTarget | null>(null)
    const [requestedOpenTermEntry, setRequestedOpenTermEntry] = useState<RequestedTermEntry | null>(null)

    const toggleFullscreen = useCallback(async () => {
        if (typeof document === 'undefined') return
        const root = document.documentElement

        try {
            if (document.fullscreenElement && document.exitFullscreen) {
                await document.exitFullscreen()
                return
            }

            if (!document.fullscreenElement && root.requestFullscreen) {
                await root.requestFullscreen()
            }
        } catch (error) {
            console.warn('Failed to toggle fullscreen:', error)
        }
    }, [])

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<OpenTermEntryEventDetail>).detail
            if (!detail?.entryId) return
            if (detail.novelId && novelId && detail.novelId !== novelId) return

            setFocusMode(false)
            setSidebarOpen(true)
            setSidebarTab('term')
            setRequestedOpenTermEntry({ entryId: detail.entryId, tab: detail.tab })
        }

        window.addEventListener(OPEN_TERM_ENTRY_EVENT, handler as EventListener)
        return () => window.removeEventListener(OPEN_TERM_ENTRY_EVENT, handler as EventListener)
    }, [novelId])

    // View filter state
    const [viewFilter, setViewFilter] = useState<ViewFilter>('everything')
    const [selectedActNumber, setSelectedActNumber] = useState<number | null>(null)

    // Expanded acts in sidebar
    const [expandedActs, setExpandedActs] = useState<Set<number>>(new Set())

    // Empty acts (acts with no chapters yet, tracked in UI only)
    const [emptyActs, setEmptyActs] = useState<Set<number>>(new Set())

    // Content state - map of chapter id to content
    const [, setChapterContents] = useState<Record<string, string>>({})

    // Settings dialog state
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [settingsInitialTab, setSettingsInitialTab] = useState<'metadata' | 'writing'>('metadata')

    // Chapter title editing state
    const [editingChapterId, setEditingChapterId] = useState<string | null>(null)
    const [editingTitle, setEditingTitle] = useState('')

    // Act title editing state
    const [editingActNumber, setEditingActNumber] = useState<number | null>(null)
    const [editingActTitle, setEditingActTitle] = useState('')
    const [actTitles, setActTitles] = useState<Record<number, string>>({})

    // Act summary editing state
    const [editingActSummaryNumber, setEditingActSummaryNumber] = useState<number | null>(null)
    const [editingActSummary, setEditingActSummary] = useState('')
    const [actSummaries, setActSummaries] = useState<Record<number, string>>({})
    const [actLabelIds, setActLabelIds] = useState<Record<number, string[]>>({})

    // Labels
    const [labels, setLabels] = useState<NovelLabel[]>([])

    // Selected chapter for navigation
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)

    // Sidebar resize
    const isResizing = useRef(false)
    const editorScrollRef = useRef<HTMLElement | null>(null)
    const editorScrollContentRef = useRef<HTMLDivElement | null>(null)
    const hasRestoredViewState = useRef(false)
    const hasInitializedViewStatePersistenceRef = useRef(false)
    const pendingScrollChapterIdRef = useRef<string | null>(null)
    const pendingWriteScrollTopRef = useRef<number | null>(null)
    const lastWriteScrollTopRef = useRef(0)
    const pendingManuscriptNavRef = useRef<{
        chapterId: string
        sceneId?: string
        termId?: string
        target?: 'manuscript' | 'summary'
    } | null>(null)

    // Right sidebar state
    const [rightSidebarWidth, setRightSidebarWidth] = useState(520) // Default to the current max width for chat/preview usage
    const [rightSidebarOpen, setRightSidebarOpen] = useState(true)

    // Resolve params
    useEffect(() => {
        params.then((p) => setNovelId(p.novelId))
    }, [params])

    const captureWriteScrollTop = useCallback(() => {
        const root = editorScrollRef.current
        if (!root) return lastWriteScrollTopRef.current
        const next = Math.max(0, root.scrollTop)
        lastWriteScrollTopRef.current = next
        return next
    }, [])

    const persistEditorViewState = useCallback((writeScrollTopOverride?: number | null) => {
        if (typeof window === 'undefined') return
        if (!novelId || !hasRestoredViewState.current) return

        const nextWriteScrollTop = typeof writeScrollTopOverride === 'number'
            ? Math.max(0, writeScrollTopOverride)
            : activeTab === 'write'
                ? captureWriteScrollTop()
                : lastWriteScrollTopRef.current

        const viewStateKey = `editor_view_state_${novelId}`
        const stateToStore: PersistedEditorViewState = {
            activeTab,
            viewFilter,
            selectedActNumber,
            selectedChapterId,
            lastChapterId: selectedChapterId || lastVisibleChapterId,
            writeScrollTop: Number.isFinite(nextWriteScrollTop) ? nextWriteScrollTop : null,
            focusMode,
        }
        localStorage.setItem(viewStateKey, JSON.stringify(stateToStore))
    }, [activeTab, captureWriteScrollTop, focusMode, lastVisibleChapterId, novelId, selectedActNumber, selectedChapterId, viewFilter])

    const handleActiveTabChange = useCallback((nextTab: NavTab) => {
        if (nextTab === activeTab) return

        if (activeTab === 'write' && nextTab !== 'write') {
            const currentScrollTop = captureWriteScrollTop()
            pendingWriteScrollTopRef.current = currentScrollTop
            persistEditorViewState(currentScrollTop)
        } else if (activeTab !== 'write' && nextTab === 'write') {
            pendingWriteScrollTopRef.current = lastWriteScrollTopRef.current
        }

        setActiveTab(nextTab)
    }, [activeTab, captureWriteScrollTop, persistEditorViewState])

    const handleBackToBookshelf = useCallback(() => {
        persistEditorViewState(activeTab === 'write' ? captureWriteScrollTop() : lastWriteScrollTopRef.current)
        router.push('/bookshelf')
    }, [activeTab, captureWriteScrollTop, persistEditorViewState, router])

    // Auth check
    useEffect(() => {
        if (isHydrated && !token) {
            router.replace('/login')
        }
    }, [token, isHydrated, router])

    // Load preferences from localStorage
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const savedWidth = localStorage.getItem('editor_sidebar_width')
            const savedOpen = localStorage.getItem('editor_sidebar_open')

            if (savedWidth) setSidebarWidth(parseInt(savedWidth))
            if (savedOpen) setSidebarOpen(savedOpen === 'true')
        }
    }, [])

    // Load act data from database when novelId changes
    const [actsFromDb, setActsFromDb] = useState<{ number: number; title: string | null }[]>([])

    const loadActData = useCallback(async () => {
        if (!novelId || !token) return
        try {
            const acts = await actApi.list(novelId)
            setActsFromDb(acts)

            // Extract titles and summaries
            const titles: Record<number, string> = {}
            const summaries: Record<number, string> = {}
            const labelIdsByAct: Record<number, string[]> = {}
            acts.forEach(act => {
                if (act.title && !isDefaultActTitleText(act.title)) {
                    titles[act.number] = act.title
                }
                if (act.summary) {
                    summaries[act.number] = act.summary
                }
                if (Array.isArray(act.labelIds)) {
                    labelIdsByAct[act.number] = act.labelIds
                }
            })
            setActTitles(titles)
            setActSummaries(summaries)
            setActLabelIds(labelIdsByAct)
        } catch (error) {
            console.error('Failed to load act data:', error)
        }
    }, [isDefaultActTitleText, novelId, token])

    useEffect(() => {
        loadActData()
    }, [loadActData])

    useEffect(() => {
        const loadLabels = async () => {
            if (!novelId || !token) return
            try {
                const fetched = await labelApi.list(novelId)
                setLabels(fetched)
            } catch (error) {
                console.error('Failed to load labels:', error)
            }
        }
        loadLabels()
    }, [novelId, token])

    // Compute empty acts based on loaded acts and chapters
    useEffect(() => {
        if (actsFromDb.length > 0) {
            const actsWithChapters = new Set(chapters.map(c => c.actNumber))
            const newEmptyActs = new Set<number>()

            actsFromDb.forEach(act => {
                if (!actsWithChapters.has(act.number)) {
                    newEmptyActs.add(act.number)
                }
            })

            setEmptyActs(newEmptyActs)
        }
    }, [actsFromDb, chapters])

    // Save preferences to localStorage
    const savePreferences = useCallback(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('editor_sidebar_width', sidebarWidth.toString())
            localStorage.setItem('editor_sidebar_open', sidebarOpen.toString())
        }
    }, [sidebarWidth, sidebarOpen])

    useEffect(() => {
        savePreferences()
    }, [sidebarWidth, sidebarOpen, savePreferences])

    // ESC to exit focus mode
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && focusMode) {
                setFocusMode(false)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [focusMode])

    const loadNovel = useCallback(async () => {
        if (!novelId) return
        try {
            const data = await novelApi.get(novelId)
            setNovel(data)
            setChapters(data.chapters || [])
            setChapterContents({})

            // Default to collapsed; expand only when focused
            setExpandedActs(new Set())
        } catch (error) {
            console.error('Failed to load novel:', error)
        } finally {
            setLoading(false)
        }
    }, [novelId, setChapterContents])

    useEffect(() => {
        if (!novelId) return
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<NovelRefreshRequestedEventDetail>).detail
            if (!detail || detail.novelId !== novelId) return
            void loadNovel()
            void loadActData()
            // Codex may have applied manuscript edits in this turn; surface them for review.
            void useSceneEditsStore.getState().refresh(novelId)
        }

        window.addEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handler as EventListener)
        return () => window.removeEventListener(NOVEL_REFRESH_REQUESTED_EVENT, handler as EventListener)
    }, [loadActData, loadNovel, novelId])

    // Load pending manuscript edits on entry, and keep them in sync on accept/reject.
    useEffect(() => {
        if (!novelId) return
        const store = useSceneEditsStore.getState()
        void store.refresh(novelId)

        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ novelId?: string }>).detail
            if (detail?.novelId && detail.novelId !== novelId) return
            void useSceneEditsStore.getState().refresh(novelId)
            // A rejected edit rewrites scene content; pull the fresh content back in.
            void novelApi.get(novelId).then((data) => setChapters(data.chapters || [])).catch(() => {})
        }

        window.addEventListener(SCENE_EDITS_CHANGED_EVENT, handler as EventListener)
        return () => {
            window.removeEventListener(SCENE_EDITS_CHANGED_EVENT, handler as EventListener)
            useSceneEditsStore.getState().clear()
        }
    }, [novelId])

    // Load novel and chapters
    useEffect(() => {
        if (token && novelId) {
            loadNovel()
        }
    }, [token, novelId, loadNovel])

    // Handle scenes update for a chapter - also updates chapter wordCount
    const handleScenesChange = useCallback((chapterId: string, newScenes: Scene[]) => {
        // Calculate total word count from all scenes
        const totalWordCount = newScenes.reduce((sum, scene) => sum + (scene.wordCount || 0), 0)
        setChapters(prev => prev.map(ch =>
            ch.id === chapterId ? { ...ch, scenes: newScenes, wordCount: totalWordCount } : ch
        ))
    }, [])

    const handleUpdateChapterTitle = async (chapterId: string, newTitle: string) => {
        // If empty, restore default title
        const chapter = chapters.find(c => c.id === chapterId)
        const globalIndex = chapter ? getGlobalChapterIndex(chapterId) : 1
        const titleToSave = newTitle.trim() || getDefaultChapterTitle(globalIndex)

        try {
            const updated = await chapterApi.update(chapterId, { title: titleToSave })
            setChapters((prev) =>
                prev.map((c) => (c.id === chapterId ? { ...c, ...updated } : c))
            )
        } catch (error) {
            console.error('Failed to update title:', error)
        }
        setEditingChapterId(null)
    }

	    const handleUpdateActTitle = async (actNumber: number, newTitle: string) => {
	        // If empty or matches default pattern, remove from custom titles (save empty)
	        const trimmedTitle = newTitle.trim()
	        const titleToSave = (!trimmedTitle || isDefaultActTitleText(trimmedTitle)) ? '' : trimmedTitle

        // Update local state
        if (titleToSave) {
            setActTitles(prev => ({ ...prev, [actNumber]: titleToSave }))
	        } else {
	            setActTitles(prev => {
	                const updated = { ...prev }
	                delete updated[actNumber]
	                return updated
	            })
	        }

	        // Keep the act list in sync immediately (e.g., for prompts menu) instead of waiting for a reload.
	        setActsFromDb((prev) => {
	            const nextTitle = titleToSave ? titleToSave : null
	            if (prev.some((a) => a.number === actNumber)) {
	                return prev.map((a) => (a.number === actNumber ? { ...a, title: nextTitle } : a))
	            }
	            return [...prev, { number: actNumber, title: nextTitle }]
	        })

	        // Save to database
	        if (novelId) {
	            try {
	                const updated = await actApi.upsert(novelId, { number: actNumber, title: titleToSave || undefined })
	                setActLabelIds(prev => ({ ...prev, [actNumber]: updated.labelIds }))
	                setActsFromDb(prev => {
	                    if (prev.some(a => a.number === actNumber)) {
	                        return prev.map((a) => (a.number === actNumber ? { ...a, title: updated.title } : a))
	                    }
	                    return [...prev, { number: actNumber, title: updated.title }]
	                })
	                dispatchNovelOutlineDataChanged({ novelId })
	            } catch (error) {
	                console.error('Failed to save act title:', error)
	            }
	        }

        setEditingActNumber(null)
    }

    const handleUpdateActSummary = async (actNumber: number, newSummary: string) => {
        // Update local state
        setActSummaries(prev => ({ ...prev, [actNumber]: newSummary }))

        // Save to database
	        if (novelId) {
	            try {
	                // Send the explicit value (including empty) so clearing the summary actually
                // persists; `|| undefined` would drop the key and the upsert route would keep
                // the old summary.
                const updated = await actApi.upsert(novelId, { number: actNumber, summary: newSummary })
	                setActLabelIds(prev => ({ ...prev, [actNumber]: updated.labelIds }))
	                setActsFromDb(prev => {
	                    if (prev.some(a => a.number === actNumber)) {
	                        return prev.map((a) => (a.number === actNumber ? { ...a, title: updated.title } : a))
	                    }
	                    return [...prev, { number: actNumber, title: updated.title }]
	                })
	                dispatchNovelOutlineDataChanged({ novelId })
	            } catch (error) {
	                console.error('Failed to save act summary:', error)
	            }
	        }

        setEditingActSummaryNumber(null)
    }

    const handleUpdateActLabels = async (actNumber: number, labelIds: string[]) => {
        setActLabelIds(prev => ({ ...prev, [actNumber]: labelIds }))

	        if (novelId) {
	            try {
	                const updated = await actApi.upsert(novelId, { number: actNumber, labelIds })
	                setActLabelIds(prev => ({ ...prev, [actNumber]: updated.labelIds }))
	                setActsFromDb(prev => {
	                    if (prev.some(a => a.number === actNumber)) {
	                        return prev.map((a) => (a.number === actNumber ? { ...a, title: updated.title } : a))
	                    }
	                    return [...prev, { number: actNumber, title: updated.title }]
	                })
	            } catch (error) {
	                console.error('Failed to save act labels:', error)
	            }
	        }
	    }

    const handleManageLabels = useCallback(() => {
        setSettingsInitialTab('writing')
        setSettingsOpen(true)
    }, [])

    // Helper to get act display title
    const getActDisplayTitle = useCallback(
        (actNumber: number) => actTitles[actNumber] || getDefaultActTitle(actNumber),
        [actTitles, getDefaultActTitle]
    )

    // Helper to check if act title is default
    const isDefaultActTitle = (actNumber: number) => {
        return !actTitles[actNumber]
    }

    // Group chapters by act
    const chaptersByAct = useMemo(() => {
        const grouped: Record<number, ChapterWithScenes[]> = {}
        chapters.forEach((chapter) => {
            if (!grouped[chapter.actNumber]) {
                grouped[chapter.actNumber] = []
            }
            grouped[chapter.actNumber].push(chapter)
        })
        // Sort chapters within each act by order
        Object.values(grouped).forEach(actChapters => {
            actChapters.sort((a, b) => a.order - b.order)
        })
        return grouped
    }, [chapters])

    // Filtered chapters based on view filter
    const filteredChapters = useMemo(() => {
        switch (viewFilter) {
            case 'everything':
                return chapters
            case 'act':
                if (selectedActNumber === null) return chapters
                return chaptersByAct[selectedActNumber] || []
            case 'chapter':
                return []
        }
    }, [chapters, viewFilter, selectedActNumber, chaptersByAct])

    const chapterIdsForScrollbarMarks = useMemo(() => {
        if (activeTab !== 'write') return []
        if (viewFilter === 'chapter') return selectedChapterId ? [selectedChapterId] : []
        return filteredChapters.map((chapter) => chapter.id)
    }, [activeTab, viewFilter, selectedChapterId, filteredChapters])

    // Get act numbers for dropdown (include both acts with chapters and empty acts)
    const actNumbers = useMemo(() => {
        const actsWithChapters = Object.keys(chaptersByAct).map(Number)
        const allActs = new Set([...actsWithChapters, ...Array.from(emptyActs)])
        return Array.from(allActs).sort((a, b) => a - b)
    }, [chaptersByAct, emptyActs])

    // Calculate total word count
    const totalWordCount = useMemo(
        () => chapters.reduce(
            (sum, chapter) => sum + chapter.scenes.reduce((sceneSum, scene) => sceneSum + scene.wordCount, 0),
            0
        ),
        [chapters]
    )

    // Memoize act word counts to avoid recalculating on unrelated re-renders
    // Recalculates when chaptersByAct changes (chapter add/delete/content save)
    const actWordCounts = useMemo(() => {
        const counts: Record<number, number> = {}
        Object.entries(chaptersByAct).forEach(([actNum, actChapters]) => {
            counts[Number(actNum)] = actChapters.reduce((sum, c) => sum + c.wordCount, 0)
        })
        return counts
    }, [chaptersByAct])

    // View filter label
    const viewFilterLabel = useMemo(() => {
        switch (viewFilter) {
            case 'everything':
                return t('view.everything')
            case 'act':
                return selectedActNumber ? getActDisplayTitle(selectedActNumber) : t('view.everything')
            case 'chapter':
                if (selectedChapterId) {
                    const chapter = chapters.find(c => c.id === selectedChapterId)
                    return chapter ? chapter.title : t('chapter.label')
                }
                return t('chapter.label')
        }
    }, [viewFilter, selectedActNumber, selectedChapterId, chapters, getActDisplayTitle, t])

    // Sorted chapters for global index calculation
    // Chapters are sorted by actNumber first, then by order within each act
    const sortedChapters = useMemo(() => {
        return [...chapters].sort((a, b) => {
            if (a.actNumber !== b.actNumber) return a.actNumber - b.actNumber
            return a.order - b.order
        })
    }, [chapters])

    // Get global chapter index (1-indexed, based on sorted order)
    const getGlobalChapterIndex = useCallback((chapterId: string) => {
        const index = sortedChapters.findIndex(c => c.id === chapterId)
        return index >= 0 ? index + 1 : 1
    }, [sortedChapters])

    // Get act display index (1-indexed, based on sorted order of all acts)
    const getActDisplayIndex = useCallback((actNumber: number) => {
        const index = actNumbers.findIndex(n => n === actNumber)
        return index >= 0 ? index + 1 : 1
    }, [actNumbers])

    // Restore view state (view filter and last chapter) per novel
    useEffect(() => {
        if (typeof window === 'undefined') return
        if (!novelId || loading || hasRestoredViewState.current) return

        const viewStateKey = `editor_view_state_${novelId}`
        const rawState = localStorage.getItem(viewStateKey)
        if (rawState) {
            try {
                const parsed = JSON.parse(rawState) as PersistedEditorViewState

                const knownChapterIds = new Set(chapters.map(c => c.id))
                const chapterActById = new Map(chapters.map(c => [c.id, c.actNumber]))

                const restoredChapterId = (parsed.selectedChapterId && knownChapterIds.has(parsed.selectedChapterId))
                    ? parsed.selectedChapterId
                    : null
                const restoredLastChapterId = (parsed.lastChapterId && knownChapterIds.has(parsed.lastChapterId))
                    ? parsed.lastChapterId
                    : null
                const restoredActFromChapter = restoredChapterId
                    ? chapterActById.get(restoredChapterId)
                    : restoredLastChapterId
                        ? chapterActById.get(restoredLastChapterId)
                        : null

                const nextActiveTab: NavTab = parsed.activeTab === 'menu'
                    || parsed.activeTab === 'write'
                    || parsed.activeTab === 'prompts'
                    || parsed.activeTab === 'skills'
                    || parsed.activeTab === 'agents'
                    || parsed.activeTab === 'review'
                    ? parsed.activeTab
                    : 'write'
                let nextViewFilter: ViewFilter = parsed.viewFilter === 'act' || parsed.viewFilter === 'chapter' || parsed.viewFilter === 'everything'
                    ? parsed.viewFilter
                    : 'everything'
                let nextSelectedActNumber = typeof parsed.selectedActNumber === 'number' ? parsed.selectedActNumber : null
                if (nextSelectedActNumber === null && restoredActFromChapter) {
                    nextSelectedActNumber = restoredActFromChapter
                }

                const resolvedChapterId = restoredChapterId || restoredLastChapterId || null
                const nextSelectedChapterId = nextViewFilter === 'chapter' ? resolvedChapterId : null
                const restoredWriteScrollTop = typeof parsed.writeScrollTop === 'number' && Number.isFinite(parsed.writeScrollTop)
                    ? Math.max(0, parsed.writeScrollTop)
                    : null

                if (nextViewFilter === 'chapter' && !nextSelectedChapterId) {
                    nextViewFilter = nextSelectedActNumber ? 'act' : 'everything'
                }
                if (nextViewFilter === 'act' && !nextSelectedActNumber) {
                    nextViewFilter = 'everything'
                }

                setActiveTab(nextActiveTab)
                setViewFilter(nextViewFilter)
                setSelectedActNumber(nextSelectedActNumber)
                setSelectedChapterId(nextSelectedChapterId)
                setFocusMode(nextActiveTab === 'write' && parsed.focusMode === true)
                lastWriteScrollTopRef.current = restoredWriteScrollTop ?? 0
                pendingWriteScrollTopRef.current = restoredWriteScrollTop
                pendingScrollChapterIdRef.current = restoredWriteScrollTop === null ? resolvedChapterId : null
            } catch {
                // Ignore invalid persisted state
            }
        }

        hasRestoredViewState.current = true
    }, [novelId, loading, chapters])

    // Ensure focused act is expanded
    useEffect(() => {
        let targetAct: number | null = null

        if (selectedChapterId) {
            const chapter = chapters.find(c => c.id === selectedChapterId)
            if (chapter) {
                targetAct = chapter.actNumber
            }
        } else if (viewFilter === 'act' && selectedActNumber !== null) {
            targetAct = selectedActNumber
        }

        if (targetAct === null) return

        setExpandedActs(prev => {
            if (prev.has(targetAct)) return prev
            const next = new Set(prev)
            next.add(targetAct)
            return next
        })
    }, [selectedChapterId, selectedActNumber, viewFilter, chapters])

    // Persist view state (view filter, focus mode and write position) per novel
    useEffect(() => {
        if (!hasRestoredViewState.current) return
        if (!hasInitializedViewStatePersistenceRef.current) {
            hasInitializedViewStatePersistenceRef.current = true
            return
        }
        persistEditorViewState()
    }, [persistEditorViewState])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const handlePageHide = () => persistEditorViewState()
        window.addEventListener('pagehide', handlePageHide)
        return () => window.removeEventListener('pagehide', handlePageHide)
    }, [persistEditorViewState])

    useEffect(() => {
        if (typeof window === 'undefined') return
        if (activeTab !== 'write') return
        if (!editorScrollRef.current) return

        const root = editorScrollRef.current
        let timeoutId: number | null = null

        const handleScroll = () => {
            const nextScrollTop = Math.max(0, root.scrollTop)
            lastWriteScrollTopRef.current = nextScrollTop

            if (!novelId || !hasRestoredViewState.current) return
            if (timeoutId !== null) window.clearTimeout(timeoutId)
            timeoutId = window.setTimeout(() => {
                persistEditorViewState(nextScrollTop)
                timeoutId = null
            }, 120)
        }

        handleScroll()
        root.addEventListener('scroll', handleScroll, { passive: true })

        return () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId)
            root.removeEventListener('scroll', handleScroll)
        }
    }, [activeTab, novelId, persistEditorViewState])

    // Track last visible chapter in the scroll container
    useEffect(() => {
        if (typeof window === 'undefined') return
        if (!editorScrollRef.current) return
        if (chapters.length === 0) return

        const root = editorScrollRef.current
        const chapterElements = chapters
            .map(chapter => document.getElementById(`chapter-${chapter.id}`))
            .filter((el): el is HTMLElement => Boolean(el))

        if (chapterElements.length === 0) return

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.filter(entry => entry.isIntersecting)
                if (visible.length === 0) return
                visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
                const topVisible = visible[0]
                const id = topVisible.target.id.replace('chapter-', '')
                setLastVisibleChapterId((prev) => (prev === id ? prev : id))
            },
            {
                root,
                rootMargin: '0px 0px -60% 0px',
                threshold: 0.1,
            }
        )

        chapterElements.forEach(el => observer.observe(el))

        return () => observer.disconnect()
    }, [chapters, viewFilter, selectedActNumber, selectedChapterId])

    // Restore write scroll position when returning to the write tab or reopening the editor
    useEffect(() => {
        if (activeTab !== 'write') return
        if (pendingManuscriptNavRef.current) return

        if (pendingWriteScrollTopRef.current !== null) {
            const targetScrollTop = pendingWriteScrollTopRef.current
            const frame = window.requestAnimationFrame(() => {
                const root = editorScrollRef.current
                if (!root) return
                root.scrollTo({ top: targetScrollTop, behavior: 'auto' })
                lastWriteScrollTopRef.current = Math.max(0, root.scrollTop)
                pendingWriteScrollTopRef.current = null
                pendingScrollChapterIdRef.current = null
            })
            return () => window.cancelAnimationFrame(frame)
        }

        if (!pendingScrollChapterIdRef.current) return
        const targetId = pendingScrollChapterIdRef.current
        const element = document.getElementById(`chapter-${targetId}`)
        if (!element) return

        element.scrollIntoView({ behavior: 'auto', block: 'start' })
        lastWriteScrollTopRef.current = editorScrollRef.current?.scrollTop ?? lastWriteScrollTopRef.current
        pendingScrollChapterIdRef.current = null
    }, [activeTab, viewFilter, selectedActNumber, selectedChapterId, chapters])

    const runPendingManuscriptNav = useCallback(() => {
        const pending = pendingManuscriptNavRef.current
        if (!pending) return

        let attempts = 0
        const tryScroll = () => {
            const current = pendingManuscriptNavRef.current
            if (!current) return

            const chapterEl = document.getElementById(`chapter-${current.chapterId}`)
            if (!chapterEl) {
                attempts += 1
                if (attempts < 10) window.setTimeout(tryScroll, 120)
                return
            }

            chapterEl.scrollIntoView({ behavior: 'smooth', block: 'start' })

            window.setTimeout(() => {
                const now = pendingManuscriptNavRef.current
                if (!now) return
                const sceneEl = now.sceneId ? document.getElementById(`scene-${now.sceneId}`) : null
                const baseEl = sceneEl ?? chapterEl

                if (sceneEl) {
                    sceneEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }

                if (now.target === 'summary' && now.sceneId) {
                    const summaryEl = document.getElementById(`scene-summary-${now.sceneId}`) as HTMLTextAreaElement | null
                    if (summaryEl) {
                        summaryEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        summaryEl.focus()
                    }
                } else if (now.termId) {
                    const mentionEl = baseEl.querySelector(`[data-term-id="${now.termId}"]`) as HTMLElement | null
                    mentionEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }

                pendingManuscriptNavRef.current = null
            }, 120)
        }

        tryScroll()
    }, [])

    const navigateToManuscriptMention = useCallback(
        (chapterId: string, sceneId?: string, termId?: string, target: 'manuscript' | 'summary' = 'manuscript') => {
            pendingWriteScrollTopRef.current = null
            setActiveTab('write')
            setFocusMode(false)

            const chapter = chapters.find((c) => c.id === chapterId) ?? null
            if (chapter) {
                setSelectedActNumber(chapter.actNumber)
            }
            setViewFilter('chapter')
            setSelectedChapterId(chapterId)

            pendingManuscriptNavRef.current = { chapterId, sceneId, termId, target }
            window.setTimeout(() => runPendingManuscriptNav(), 0)
        },
        [chapters, runPendingManuscriptNav]
    )

    // Navigate from the plan/menu view into the write view with the appropriate focus.
    // - act:     volume (act) focus, scrolled to the start of the volume
    // - chapter: volume (act) focus, scrolled to that chapter
    // - scene:   chapter focus, scrolled to that scene
    const navigateToWriteTarget = useCallback(
        (
            target:
                | { kind: 'act'; actNumber: number }
                | { kind: 'chapter'; chapterId: string }
                | { kind: 'scene'; chapterId: string; sceneId: string }
        ) => {
            pendingWriteScrollTopRef.current = null
            setActiveTab('write')
            setFocusMode(false)

            if (target.kind === 'act') {
                const firstChapter = (chaptersByAct[target.actNumber] || [])[0] ?? null
                setViewFilter('act')
                setSelectedActNumber(target.actNumber)
                setSelectedChapterId(null)
                if (firstChapter) {
                    pendingManuscriptNavRef.current = { chapterId: firstChapter.id, target: 'manuscript' }
                    window.setTimeout(() => runPendingManuscriptNav(), 0)
                } else {
                    pendingManuscriptNavRef.current = null
                }
                return
            }

            const chapter = chapters.find((c) => c.id === target.chapterId) ?? null

            if (target.kind === 'chapter') {
                setViewFilter('act')
                if (chapter) setSelectedActNumber(chapter.actNumber)
                setSelectedChapterId(target.chapterId)
                pendingManuscriptNavRef.current = { chapterId: target.chapterId, target: 'manuscript' }
                window.setTimeout(() => runPendingManuscriptNav(), 0)
                return
            }

            // scene -> chapter focus
            setViewFilter('chapter')
            if (chapter) setSelectedActNumber(chapter.actNumber)
            setSelectedChapterId(target.chapterId)
            pendingManuscriptNavRef.current = {
                chapterId: target.chapterId,
                sceneId: target.sceneId,
                target: 'manuscript',
            }
            window.setTimeout(() => runPendingManuscriptNav(), 0)
        },
        [chapters, chaptersByAct, runPendingManuscriptNav]
    )

    const navigateToSnippet = useCallback((snippetId: string) => {
        setSidebarTab('snippets')
        setRequestedOpenSnippetId(snippetId)
    }, [])

    const openOutlineForAct = useCallback((actNumber: number) => {
        setSidebarOpen(true)
        setSidebarTab('chapterOutline')
        setRequestedOpenOutlineTarget({ kind: 'act', actNumber })
    }, [])

    const openOutlineForChapter = useCallback((chapterId: string) => {
        setSidebarOpen(true)
        setSidebarTab('chapterOutline')
        setRequestedOpenOutlineTarget({ kind: 'chapter', chapterId })
    }, [])

    const navigateToOutline = useCallback(
        (target: { kind: 'act'; actNumber: number } | { kind: 'chapter'; chapterId: string }) => {
            if (target.kind === 'act') {
                openOutlineForAct(target.actNumber)
            } else {
                openOutlineForChapter(target.chapterId)
            }
        },
        [openOutlineForAct, openOutlineForChapter]
    )

    useEffect(() => {
        if (activeTab !== 'write') return
        if (!pendingManuscriptNavRef.current) return
        runPendingManuscriptNav()
    }, [activeTab, viewFilter, selectedActNumber, selectedChapterId, chapters, runPendingManuscriptNav])

    const {
        handleCreateChapter,
        handleCreateAct,
        handleDeleteChapter,
        handleDeleteAct,
        handleInsertChapter,
        handleInsertAct,
        handleReorderActs,
        handleReorderChapters,
    } = createActChapterActions({
        novelId,
        chapters,
        sortedChapters,
        chaptersByAct,
        emptyActs,
        actsFromDb,
        actTitles,
        actSummaries,
        actLabelIds,
        getDefaultChapterTitle,
        isDefaultChapterTitle,
        setChapters,
        setChapterContents,
        setEmptyActs,
        setActsFromDb,
        setExpandedActs,
        setViewFilter,
        setSelectedActNumber,
        setActTitles,
        setActSummaries,
        setActLabelIds,
    })

    // Sidebar is compact when width < 260px - hide labels to prevent text clipping

    // Handle sidebar resize
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current) return
        e.preventDefault()
        const newWidth = Math.max(180, Math.min(400, e.clientX))
        setSidebarWidth(newWidth)
    }, [])

    const handleMouseUp = useCallback(() => {
        isResizing.current = false
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
    }, [handleMouseMove])

    const startResizing = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        isResizing.current = true
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }, [handleMouseMove, handleMouseUp])

    // Toggle act expansion
    const toggleAct = (actNumber: number) => {
        setExpandedActs(prev => {
            const next = new Set(prev)
            if (next.has(actNumber)) {
                next.delete(actNumber)
            } else {
                next.add(actNumber)
            }
            return next
        })
    }

    if (!isHydrated || loading || !token) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-lg">{tCommon('loading')}</div>
            </div>
        )
    }

    const navTabs: { id: NavTab; label: string; icon: React.ReactNode }[] = [
        { id: 'menu', label: t('nav.menu'), icon: <ClipboardList className="h-4 w-4" /> },
        { id: 'write', label: t('nav.write'), icon: <Edit3 className="h-4 w-4" /> },
        { id: 'prompts', label: t('nav.prompts'), icon: <Sparkles className="h-4 w-4" /> },
        { id: 'skills', label: t('nav.skills'), icon: <Sparkles className="h-4 w-4" /> },
        { id: 'agents', label: t('nav.agents'), icon: <Bot className="h-4 w-4" /> },
        { id: 'review', label: t('nav.review'), icon: <BookMarked className="h-4 w-4" /> },
    ]

    const isStandaloneTab = activeTab === 'menu' || activeTab === 'prompts' || activeTab === 'skills' || activeTab === 'agents'

    return (
        <div className="h-screen flex flex-col bg-background">
            {/* Header - hidden in focus mode */}
            {!focusMode && (
                <header className="h-14 border-b bg-card flex items-center px-4 gap-2 shrink-0">
                    {/* Back button and novel info */}
                    <Button variant="ghost" size="icon" onClick={handleBackToBookshelf}>
                        <ChevronLeft className="h-5 w-5" />
                    </Button>

                    {/* Novel thumbnail */}
                    {novel?.coverImage ? (
                        <div className="relative h-8 w-8 overflow-hidden rounded">
                            <Image
                                src={novel.coverImage}
                                alt={novel.title}
                                fill
                                sizes="32px"
                                unoptimized
                                className="object-cover"
                            />
                        </div>
                    ) : (
                        <div className="h-8 w-8 rounded bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                            <BookOpen className="h-4 w-4 text-white" />
                        </div>
                    )}

                    <span className="font-medium text-sm truncate max-w-[100px]">{novel?.title}</span>

	                    <Button
	                        variant="ghost"
	                        size="icon"
	                        onClick={() => {
	                            setSettingsInitialTab('metadata')
	                            setSettingsOpen(true)
	                        }}
	                    >
	                        <Settings className="h-4 w-4" />
	                    </Button>

                    <Separator orientation="vertical" className="h-6 mx-2" />

                    {/* Nav tabs */}
                    <div className="flex gap-1">
                        {navTabs.map((tab) => (
                            <Button
                                key={tab.id}
                                variant="ghost"
                                size="sm"
                                className={`gap-1 ${activeTab === tab.id ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}`}
                                onClick={() => handleActiveTabChange(tab.id)}
                            >
                                {tab.icon}
                                {tab.label}
                            </Button>
                        ))}
                    </div>

                    <div className="flex-1" />

                    {!isStandaloneTab && (
                        <>
                            {/* View filter dropdown */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="gap-1">
                                        {viewFilterLabel}
                                        <ChevronDown className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setViewFilter('everything')
                                            setSelectedActNumber(null)
                                            setSelectedChapterId(null)
                                        }}
                                    >
                                        {viewFilter === 'everything' && <Check className="h-4 w-4 mr-2" />}
                                        <span className={viewFilter === 'everything' ? '' : 'ml-6'}>{t('view.everything')}</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {actNumbers.map((actNum) => {
                                        const actChapters = chaptersByAct[actNum] || []
                                        const isActSelected =
                                            (viewFilter === 'act' && selectedActNumber === actNum) ||
                                            (viewFilter === 'chapter' && selectedActNumber === actNum)
                                        return (
                                            <DropdownMenuSub key={actNum}>
                                                <DropdownMenuSubTrigger
                                                    className={isActSelected ? 'bg-muted' : ''}
                                                    onClick={(e) => {
                                                        // Clicking directly on the subtrigger also triggers act focus
                                                        e.preventDefault()
                                                        setViewFilter('act')
                                                        setSelectedActNumber(actNum)
                                                        setSelectedChapterId(null)
                                                    }}
                                                >
                                                    {isActSelected && (
                                                        <Check className="h-4 w-4 mr-2" />
                                                    )}
                                                    <span className={isActSelected ? '' : 'ml-6'}>
                                                        {getActDisplayTitle(actNum)}
                                                    </span>
                                                    <span className="ml-auto text-muted-foreground text-xs mr-2">
                                                        {actChapters.length} {actChapters.length === 1 ? t('view.chapter') : t('view.chapters')}
                                                    </span>
                                                </DropdownMenuSubTrigger>
                                                <DropdownMenuSubContent className="w-56">
                                                    {/* Act focus option */}
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setViewFilter('act')
                                                            setSelectedActNumber(actNum)
                                                            setSelectedChapterId(null)
                                                        }}
                                                    >
                                                        {viewFilter === 'act' && selectedActNumber === actNum && !selectedChapterId && (
                                                            <Check className="h-4 w-4 mr-2" />
                                                        )}
                                                        <span className={viewFilter === 'act' && selectedActNumber === actNum && !selectedChapterId ? '' : 'ml-6'}>
                                                            {t('view.viewEntireAct')}
                                                        </span>
                                                    </DropdownMenuItem>
                                                    {actChapters.length > 0 && <DropdownMenuSeparator />}
                                                    {/* Individual chapters */}
                                                    {actChapters.map((chapter) => (
                                                        <DropdownMenuItem
                                                            key={chapter.id}
                                                            onClick={() => {
                                                                setViewFilter('chapter')
                                                                setSelectedActNumber(actNum)
                                                                setSelectedChapterId(chapter.id)
                                                            }}
                                                        >
                                                            {viewFilter === 'chapter' && selectedChapterId === chapter.id && (
                                                                <Check className="h-4 w-4 mr-2" />
                                                            )}
                                                            <span className={viewFilter === 'chapter' && selectedChapterId === chapter.id ? '' : 'ml-6'}>
                                                                {chapter.title}
                                                            </span>
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                        )
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Word count */}
                            <span className="text-sm text-muted-foreground">
                                {totalWordCount.toLocaleString()} {tCommon('words')}
                            </span>

                            <Separator orientation="vertical" className="h-6 mx-2" />

                            {/* Format and Focus buttons */}
                            <WriteFormatMenu />
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1"
                                onClick={() => void toggleFullscreen()}
                            >
                                <Maximize2 className="h-4 w-4" />
                                {t('header.focus')}
                            </Button>
                        </>
                    )}
                </header>
            )}

	            <div className="flex-1 flex overflow-hidden relative">
	                {/* Sidebar - hidden in focus mode */}
	                {!focusMode && sidebarOpen && !isStandaloneTab && (
	                    <LeftPanelMenu
		                        sidebarWidth={sidebarWidth}
		                        sidebarTab={sidebarTab}
	                        novelId={novelId ?? undefined}
	                        requestedOpenSnippetId={requestedOpenSnippetId}
	                        onRequestedOpenSnippetHandled={() => setRequestedOpenSnippetId(null)}
	                        requestedOpenTermEntry={requestedOpenTermEntry}
	                        onRequestedOpenTermEntryHandled={() => setRequestedOpenTermEntry(null)}
	                        requestedOpenOutlineTarget={requestedOpenOutlineTarget}
	                        onRequestedOpenOutlineHandled={() => setRequestedOpenOutlineTarget(null)}
	                        chapters={chapters}
	                        actNumbers={actNumbers}
	                        expandedActs={expandedActs}
	                        chaptersByAct={chaptersByAct}
	                        actWordCounts={actWordCounts}
                        selectedChapterId={selectedChapterId}
	                        editingChapterId={editingChapterId}
	                        editingActNumber={editingActNumber}
	                        onSidebarClose={() => setSidebarOpen(false)}
	                        onSidebarTabChange={(tab) => {
                                setSidebarTab(tab)
                                if (tab === 'codex') {
                                    setRightSidebarOpen(true)
                                    setInfoPanelActiveTab('codex')
                                } else if (tab === 'chats') {
                                    setRightSidebarOpen(true)
                                    setInfoPanelActiveTab('chat')
                                }
                            }}
	                        onToggleAct={toggleAct}
	                        onChapterClick={(chapter, actNum) => {
                            setViewFilter('act')
                            setSelectedActNumber(actNum)
                            setSelectedChapterId(chapter.id)

                            const chapterId = chapter.id
                            let attempts = 0
                            const tryDispatch = () => {
                                const el = document.getElementById(`chapter-${chapterId}`)
                                if (el) {
                                    dispatchWriteJump({ chapterId, source: 'sidebar' })
                                    return
                                }
                                attempts += 1
                                if (attempts < 10) window.setTimeout(tryDispatch, 120)
                            }

                            window.setTimeout(tryDispatch, 0)
	                        }}
	                        onNavigateToManuscript={navigateToManuscriptMention}
	                        onNavigateToSnippet={navigateToSnippet}
	                        onNavigateToOutline={navigateToOutline}
	                        onStartResize={startResizing}
	                        getActDisplayTitle={getActDisplayTitle}
	                        getGlobalChapterIndex={getGlobalChapterIndex}
	                    />
	                )}

	                {/* Show sidebar button when hidden */}
	                {!focusMode && !sidebarOpen && !isStandaloneTab && (
	                    <Button
	                        variant="ghost"
	                        size="icon-sm"
	                        className="absolute left-2 top-8 z-10"
	                        onClick={() => setSidebarOpen(true)}
	                        title={t('sidebar.expand')}
	                        aria-label={t('sidebar.expand')}
	                    >
	                        <PanelRightClose className="h-4 w-4" />
	                    </Button>
	                )}

	                {/* Show right sidebar button when hidden */}
	                {!focusMode && !rightSidebarOpen && !isStandaloneTab && (
	                    <Button
	                        variant="ghost"
	                        size="icon-sm"
	                        className="absolute right-2 top-8 z-10"
	                        onClick={() => setRightSidebarOpen(true)}
	                        title={t('header.showInfoPanel')}
	                        aria-label={t('header.showInfoPanel')}
	                    >
	                        <PanelLeftClose className="h-4 w-4" />
	                    </Button>
	                )}

		                {/* Main Editor - Scrollable chapters view */}
		                <div className="flex-1 min-w-0 relative overflow-hidden">
		                    <main
		                        ref={editorScrollRef}
		                        className="absolute inset-0 overflow-auto bg-background onw-editor-scrollbar"
		                    >
		                        <div ref={editorScrollContentRef} className="min-h-full">
	                            {/* Menu View - Drag and drop reordering */}
	                            {activeTab === 'menu' && novelId && (
	                                <MiddlePanelMenu
                                        novelId={novelId}
	                                    chapters={chapters}
	                                    actsFromDb={actsFromDb}
                                        labels={labels}
                                    emptyActs={emptyActs}
                                    onReorderActs={handleReorderActs}
                                    onReorderChapters={handleReorderChapters}
                                    onCreateChapter={handleCreateChapter}
                                    onCreateAct={handleCreateAct}
                                    onDeleteChapter={handleDeleteChapter}
                                    onDeleteAct={handleDeleteAct}
                                    getGlobalChapterIndex={getGlobalChapterIndex}
                                    getActDisplayTitle={getActDisplayTitle}
                                    onScenesChange={handleScenesChange}
                                    onManageLabels={handleManageLabels}
                                    onNavigateToWrite={navigateToWriteTarget}
                                />
                            )}

                            {/* Write View - Editor content */}
                            {activeTab === 'write' && (
                                <MiddlePanelWrite
                                    novelId={novelId ?? undefined}
                                    focusMode={focusMode}
                                    viewFilter={viewFilter}
                                    selectedActNumber={selectedActNumber}
                                    selectedChapterId={selectedChapterId}
                                    labels={labels}
                                    onManageLabels={handleManageLabels}
                                    chapters={chapters}
                                    chaptersByAct={chaptersByAct}
                                    actNumbers={actNumbers}
                                    emptyActs={emptyActs}
                                    actTitles={actTitles}
                                    actSummaries={actSummaries}
                                    actLabelIds={actLabelIds}
                                    editingChapterId={editingChapterId}
                                    editingTitle={editingTitle}
                                    editingActNumber={editingActNumber}
                                    editingActTitle={editingActTitle}
                                    editingActSummaryNumber={editingActSummaryNumber}
                                    editingActSummary={editingActSummary}
                                    onExitFocusMode={() => setFocusMode(false)}
                                    onOpenRightSidebar={() => setRightSidebarOpen(true)}
                                    onScenesChange={handleScenesChange}
                                    onUpdateChapterTitle={handleUpdateChapterTitle}
                                    onUpdateActTitle={handleUpdateActTitle}
                                    onUpdateActSummary={handleUpdateActSummary}
                                    onUpdateActLabels={handleUpdateActLabels}
                                    onOpenOutlineForAct={openOutlineForAct}
                                    onOpenOutlineForChapter={openOutlineForChapter}
                                    onInsertChapter={handleInsertChapter}
                                    onInsertAct={handleInsertAct}
                                    onDeleteChapter={handleDeleteChapter}
                                    onDeleteAct={handleDeleteAct}
                                    onCreateChapter={handleCreateChapter}
                                    onCreateAct={handleCreateAct}
                                    setEditingChapterId={setEditingChapterId}
                                    setEditingTitle={setEditingTitle}
                                    setEditingActNumber={setEditingActNumber}
                                    setEditingActTitle={setEditingActTitle}
                                    setEditingActSummaryNumber={setEditingActSummaryNumber}
                                    setEditingActSummary={setEditingActSummary}
                                    getGlobalChapterIndex={getGlobalChapterIndex}
                                    getActDisplayIndex={getActDisplayIndex}
                                    getActDisplayTitle={getActDisplayTitle}
                                    isDefaultChapterTitle={isDefaultChapterTitle}
                                    isDefaultActTitle={isDefaultActTitle}
                                />
                            )}

                            {/* Prompts View - Cross-novel prompt library */}
                            {activeTab === 'prompts' && (
                                <MiddlePanelPrompts
                                    novelId={novelId ?? undefined}
                                />
                            )}

                            {activeTab === 'skills' && (
                                <MiddlePanelSkills
                                    novelId={novelId ?? undefined}
                                />
                            )}

                            {activeTab === 'agents' && (
                                <MiddlePanelAgents
                                    novelId={novelId ?? undefined}
                                />
                            )}

                            {activeTab === 'review' && novelId && (
                                <MiddlePanelReview
                                    novelId={novelId}
                                    chapters={chapters}
                                    onNavigateToScene={(chapterId, sceneId) => navigateToWriteTarget({ kind: 'scene', chapterId, sceneId })}
                                />
                            )}
                        </div>
                    </main>

                    <ChapterScrollbarMarks
                        enabled={activeTab === 'write' && chapterIdsForScrollbarMarks.length > 0}
                        scrollContainerRef={editorScrollRef}
                        contentRef={editorScrollContentRef}
                        chapterIds={chapterIdsForScrollbarMarks}
                    />

                    {activeTab === 'write' && novelId && (
                        <ManuscriptReviewToolbar
                            novelId={novelId}
                            chapterOrder={chapters.map((chapter) => ({ id: chapter.id, actNumber: chapter.actNumber }))}
                            onNavigate={navigateToWriteTarget}
                        />
                    )}
                </div>

                {/* Right Sidebar */}
                {!focusMode && rightSidebarOpen && !isStandaloneTab && (
                    <RightPanel
                        novelId={novelId ?? undefined}
                        width={rightSidebarWidth}
                        onClose={() => setRightSidebarOpen(false)}
                        onWidthChange={setRightSidebarWidth}
                        onNavigateToWrite={navigateToWriteTarget}
                    />
                )}
            </div>

            {/* Novel Settings Dialog */}
            <NovelSettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                novel={novel}
                onUpdate={(updated) => setNovel(updated)}
                labels={labels}
                onLabelsChange={setLabels}
                initialTab={settingsInitialTab}
            />
        </div>
    )
}
