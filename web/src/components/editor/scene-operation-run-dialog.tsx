'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Brain, Check, ChevronDown, ChevronRight, Eye, Loader2, SlidersHorizontal, Sparkles } from 'lucide-react'
import { ModelGroupLogoIcon } from '@/components/ai/model-group-logo-icon'
import { PreviewInputCard } from '@/components/editor/prompt-inputs-editor/preview-input-card'
import { PreviewRenderedSection } from '@/components/editor/prompt-inputs-editor/preview-rendered-section'
import { useInputsEditorModel } from '@/components/editor/prompt-inputs-editor/model'
import type { SceneOperationPromptMenuRunSpec } from '@/components/editor/scene-operation-prompt-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { ChapterWithScenes, Novel, Prompt, Scene } from '@/lib/api'
import { novelApi, promptApi } from '@/lib/api'
import { getAvailableModelAssignments, runModelGroupWithFallback } from '@/lib/ai-runner'
import { cn } from '@/lib/utils'

type SceneOperationRunTab = 'tweak' | 'preview'

function isAbortError(error: unknown) {
    return (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError')
    )
}

function buildChaptersForScenePromptPreview(params: {
    novelId?: string
    chapterId: string
    chapterTitle?: string
    scenes: Scene[]
    localEdits: Record<string, string>
    novelData: (Novel & { chapters: ChapterWithScenes[] }) | null
}): ChapterWithScenes[] {
    const { novelId, chapterId, chapterTitle, scenes, localEdits, novelData } = params
    const mergedScenes = scenes
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((scene) => ({
            ...scene,
            content: localEdits[scene.id] ?? scene.content ?? '',
        }))

    const chapters = (novelData?.chapters ?? []).map((chapter) => {
        if (chapter.id !== chapterId) return chapter
        return {
            ...chapter,
            title: chapterTitle ?? chapter.title,
            scenes: mergedScenes,
        }
    })

    if (chapters.length > 0) return chapters

    const now = new Date().toISOString()
    return [
        {
            id: chapterId,
            title: chapterTitle ?? '',
            actNumber: 1,
            order: 1,
            wordCount: 0,
            novelId: novelId ?? '',
            createdAt: now,
            updatedAt: now,
            scenes: mergedScenes,
        },
    ]
}

export function SceneOperationRunDialog({
    open,
    onOpenChange,
    novelId,
    chapterId,
    chapterTitle,
    sceneId,
    scenes,
    localEdits,
    spec,
    onComplete,
    onRunningChange,
    autoRunRequest,
}: {
    open: boolean
    onOpenChange: (open: boolean, options?: { preserveState?: boolean }) => void
    novelId?: string
    chapterId: string
    chapterTitle?: string
    sceneId: string
    scenes: Scene[]
    localEdits: Record<string, string>
    spec: SceneOperationPromptMenuRunSpec
    onComplete: (text: string) => void | Promise<void>
    onRunningChange?: (running: boolean) => void
    autoRunRequest?: { key: number } | null
}) {
    const tCommon = useTranslations('common')
    const tPrompts = useTranslations('prompts')
    const tSceneOperation = useTranslations('editor.sceneOperation')

    const [activeTab, setActiveTab] = useState<SceneOperationRunTab>('tweak')
    const [componentPrompts, setComponentPrompts] = useState<Prompt[] | null>(null)
    const [chapters, setChapters] = useState<ChapterWithScenes[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [runError, setRunError] = useState<string | null>(null)
    const [generating, setGenerating] = useState(false)
    const [selectedGroupId, setSelectedGroupId] = useState('')
    const [resultText, setResultText] = useState('')
    const [reasoningText, setReasoningText] = useState('')
    const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle')
    const [reasoningExpanded, setReasoningExpanded] = useState(false)
    const runAbortRef = useRef<AbortController | null>(null)
    const consumedAutoRunRequestKeyRef = useRef<number | null>(null)

    const runnableGroups = useMemo(
        () => spec.groups.filter((group) => getAvailableModelAssignments(group).length > 0),
        [spec.groups]
    )

    useEffect(() => {
        setSelectedGroupId(runnableGroups[0]?.id ?? spec.groups[0]?.id ?? '')
        setActiveTab('tweak')
        setResultText('')
        setReasoningText('')
        setRunError(null)
        setRunStatus('idle')
        setReasoningExpanded(false)
        consumedAutoRunRequestKeyRef.current = null
    }, [runnableGroups, spec])

    const shouldLoad =
        open || Boolean(autoRunRequest) || generating || Boolean(resultText) || Boolean(reasoningText) || Boolean(runError)

    useEffect(() => {
        if (!shouldLoad) return
        let cancelled = false

        async function load() {
            setLoadError(null)
            try {
                const [components, novelData] = await Promise.all([
                    promptApi.list({ category: 'component' }).then((result) => result.prompts ?? []),
                    novelId ? novelApi.get(novelId) : Promise.resolve(null),
                ])
                if (cancelled) return
                setComponentPrompts(components)
                setChapters(
                    buildChaptersForScenePromptPreview({
                        novelId,
                        chapterId,
                        chapterTitle,
                        scenes,
                        localEdits,
                        novelData,
                    })
                )
            } catch (error) {
                console.error('Failed to load scene operation dialog data:', error)
                if (cancelled) return
                setLoadError(error instanceof Error ? error.message : String(error))
                setComponentPrompts([])
                setChapters(
                    buildChaptersForScenePromptPreview({
                        novelId,
                        chapterId,
                        chapterTitle,
                        scenes,
                        localEdits,
                        novelData: null,
                    })
                )
            }
        }

        void load()

        return () => {
            cancelled = true
        }
    }, [chapterId, chapterTitle, localEdits, novelId, scenes, shouldLoad])

    const currentSceneHtml = useMemo(
        () => localEdits[sceneId] ?? scenes.find((scene) => scene.id === sceneId)?.content ?? '',
        [localEdits, sceneId, scenes]
    )

    const model = useInputsEditorModel({
        inputDefinitions: spec.prompt.inputs ?? [],
        disabled: generating,
        onInputDefinitionsChange: () => undefined,
        messages: spec.prompt.messages ?? [],
        promptId: spec.prompt.id,
        promptCategory: String(spec.prompt.category ?? 'scene_action'),
        allPrompts: componentPrompts ?? undefined,
        novelId,
        chapters: chapters ?? undefined,
    })

    // `model` is a fresh object every render (useInputsEditorModel returns a plain literal),
    // so depend on the stable `setPreviewSceneId` callback to avoid an every-render setState loop.
    const { setPreviewSceneId } = model
    useEffect(() => {
        if (!shouldLoad) return
        setPreviewSceneId(sceneId)
    }, [setPreviewSceneId, sceneId, shouldLoad])

    useEffect(() => {
        if (open && (generating || resultText.trim() || reasoningText.trim() || runError)) {
            setActiveTab('preview')
        }
    }, [generating, open, reasoningText, resultText, runError])

    const selectedGroup = useMemo(
        () =>
            runnableGroups.find((group) => group.id === selectedGroupId) ??
            runnableGroups[0] ??
            spec.groups.find((group) => group.id === selectedGroupId) ??
            spec.groups[0] ??
            null,
        [runnableGroups, selectedGroupId, spec.groups]
    )
    const ready = componentPrompts !== null && chapters !== null && Boolean(selectedGroup)
    const missingRequired = model.missingRequiredInputNames.length > 0
    const renderedMessages = useMemo(
        () =>
            model.renderedMessages
                .map((message) => ({ role: message.role, content: message.content }))
                .filter((message) => message.content.trim()),
        [model.renderedMessages]
    )
    const canGenerate =
        ready &&
        !generating &&
        !missingRequired &&
        Boolean(selectedGroup) &&
        getAvailableModelAssignments(selectedGroup).length > 0 &&
        renderedMessages.length > 0
    const showRunState = generating || Boolean(resultText.trim()) || Boolean(reasoningText.trim()) || Boolean(runError)

    const startRun = useCallback(
        async (options?: { closeOnStart?: boolean }) => {
            if (!canGenerate || !selectedGroup) return
            runAbortRef.current?.abort()
            const controller = new AbortController()
            runAbortRef.current = controller
            onRunningChange?.(true)
            setGenerating(true)
            setRunError(null)
            setResultText('')
            setReasoningText('')
            setRunStatus('running')
            setReasoningExpanded(false)
            setActiveTab('preview')

            if (options?.closeOnStart) {
                onOpenChange(false, { preserveState: true })
            }

            try {
                const result = await runModelGroupWithFallback({
                    group: selectedGroup,
                    input: {
                        stream: true,
                        temperature: selectedGroup.settings.temperature ?? undefined,
                        maxTokens: selectedGroup.settings.maxTokens ?? undefined,
                        messages: renderedMessages,
                    },
                    signal: controller.signal,
                    onTextDelta: (delta) => {
                        setResultText((current) => `${current}${delta}`)
                    },
                    onReasoningDelta: (delta) => {
                        setReasoningText((current) => `${current}${delta}`)
                    },
                })

                if (controller.signal.aborted || runAbortRef.current !== controller) return
                const text = (result.text ?? '').trim()
                setReasoningText(result.reasoningText ?? '')
                setRunStatus('completed')
                if (text) {
                    await onComplete(text)
                    onOpenChange(false)
                }
            } catch (error) {
                if (!isAbortError(error)) {
                    console.error('Failed to run scene operation:', error)
                    setRunError(error instanceof Error ? error.message : String(error))
                    setRunStatus('error')
                    onOpenChange(true, { preserveState: true })
                }
            } finally {
                if (runAbortRef.current === controller) {
                    runAbortRef.current = null
                }
                onRunningChange?.(false)
                setGenerating(false)
            }
        },
        [canGenerate, onComplete, onOpenChange, onRunningChange, renderedMessages, selectedGroup]
    )

    useEffect(() => {
        if (!autoRunRequest) return
        if (consumedAutoRunRequestKeyRef.current === autoRunRequest.key) return
        if (!canGenerate || runAbortRef.current) return
        consumedAutoRunRequestKeyRef.current = autoRunRequest.key
        void startRun()
    }, [autoRunRequest, canGenerate, startRun])

    const resetRunState = useCallback(() => {
        runAbortRef.current = null
        onRunningChange?.(false)
        setGenerating(false)
        setRunError(null)
        setResultText('')
        setReasoningText('')
        setRunStatus('idle')
        setReasoningExpanded(false)
        setActiveTab('tweak')
    }, [onRunningChange])

    const handleDismiss = () => {
        onOpenChange(false, {
            preserveState:
                runAbortRef.current !== null ||
                generating ||
                Boolean(resultText.trim()) ||
                Boolean(reasoningText.trim()) ||
                Boolean(runError),
        })
    }

    const handleTerminate = () => {
        runAbortRef.current?.abort()
        resetRunState()
        onOpenChange(false)
    }

    const tabButton = (tab: SceneOperationRunTab, label: string, icon: ReactNode) => (
        <button
            type="button"
            className={cn(
                'inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
            )}
            onClick={() => setActiveTab(tab)}
        >
            {icon}
            {label}
        </button>
    )

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (nextOpen) {
                    onOpenChange(true)
                    return
                }
                handleDismiss()
            }}
        >
            <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                        <DialogTitle className="text-xl">{spec.prompt.name}</DialogTitle>
                        {(loadError || runError) && (
                            <div className="truncate text-sm text-destructive">{runError ?? loadError}</div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 border-b">
                        {tabButton('tweak', tPrompts('advanced.inputs.title'), <SlidersHorizontal className="h-4 w-4" />)}
                        {tabButton('preview', tPrompts('advanced.preview.title'), <Eye className="h-4 w-4" />)}
                    </div>

                    <div className="min-h-[320px]">
                        {activeTab === 'tweak' ? (
                            <div className="rounded-md border bg-card p-4 space-y-4">
                                <div>
                                    <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                                        <SlidersHorizontal className="h-4 w-4" />
                                        {tPrompts('advanced.inputs.title')}
                                    </div>
                                    {model.previewInputs.length === 0 ? (
                                        <div className="rounded-md border bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
                                            {tPrompts('advanced.inputs.empty')}
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {model.previewInputs.map((input) => (
                                                <PreviewInputCard key={input.id} input={input} model={model} />
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-lg border bg-muted/20 px-3 py-3 space-y-2">
                                    <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                                        <Sparkles className="h-4 w-4" />
                                        {tSceneOperation('modelGroups')}
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {spec.groups.map((group) => {
                                            const isSelected = selectedGroup?.id === group.id
                                            const availableAssignments = getAvailableModelAssignments(group)
                                            const disabled = generating || availableAssignments.length === 0
                                            return (
                                                <Button
                                                    key={group.id}
                                                    type="button"
                                                    size="sm"
                                                    variant={isSelected ? 'default' : 'outline'}
                                                    disabled={disabled}
                                                    className="h-9 gap-2 px-3"
                                                    onClick={() => setSelectedGroupId(group.id)}
                                                >
                                                    {isSelected && <Check className="h-4 w-4" />}
                                                    <ModelGroupLogoIcon
                                                        group={group}
                                                        fallbackLabel={group.name}
                                                        className="h-5 w-5 rounded-md"
                                                        imageClassName="h-5 w-5"
                                                    />
                                                    <span className="max-w-[14rem] truncate">{group.name}</span>
                                                    {availableAssignments.length === 0 && (
                                                        <span className="text-[11px] opacity-80">{tSceneOperation('noAssignments')}</span>
                                                    )}
                                                </Button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="rounded-md border bg-card p-4">
                                    <PreviewRenderedSection model={model} showInputs={false} />
                                </div>

                                {showRunState && (
                                    <div className="rounded-md border bg-card p-4">
                                        <div className="space-y-2">
                                            <div className="text-sm font-medium">{tSceneOperation('modelOutput')}</div>
                                            {resultText.trim() ? (
                                                <div className="max-h-[360px] overflow-y-auto rounded-md border bg-background/80 px-3 py-3 text-sm whitespace-pre-wrap">
                                                    {resultText}
                                                </div>
                                            ) : (
                                                <div className="rounded-md border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
                                                    {generating
                                                        ? tSceneOperation('resultWaiting')
                                                        : tSceneOperation('resultEmpty')}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {showRunState && (
                                    <div className="rounded-lg border bg-muted/20 px-3 py-3 space-y-2">
                                        <div className="flex items-center justify-between gap-3 text-sm">
                                            <span className="font-medium">{tSceneOperation('modelResponse')}</span>
                                            {generating && (
                                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    {tSceneOperation('running')}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between gap-3 text-xs">
                                            <span className="font-medium truncate">{spec.prompt.name}</span>
                                            <span className="text-muted-foreground">
                                                {runStatus === 'completed'
                                                    ? tSceneOperation('runStepCompleted')
                                                    : runStatus === 'error'
                                                      ? tSceneOperation('runStepFailed')
                                                      : runStatus === 'running'
                                                        ? tSceneOperation('runStepRunning')
                                                        : tSceneOperation('runStarting')}
                                            </span>
                                        </div>

                                        {reasoningText.trim() && (
                                            <div className="space-y-1">
                                                <button
                                                    type="button"
                                                    className="w-full flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs text-left"
                                                    onClick={() => setReasoningExpanded((current) => !current)}
                                                >
                                                    <span className="inline-flex items-center gap-2 min-w-0">
                                                        <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                        <span className="font-medium truncate">
                                                            {tSceneOperation('reasoningSummary')}
                                                        </span>
                                                    </span>
                                                    {reasoningExpanded ? (
                                                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                    ) : (
                                                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                    )}
                                                </button>
                                                {reasoningExpanded && (
                                                    <div className="rounded-md border bg-background/80 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
                                                        {reasoningText}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {resultText.trim() ? (
                                            <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                                                {resultText}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-muted-foreground">{tSceneOperation('runStarting')}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between gap-4">
                        <div className={cn('min-h-4 text-xs text-muted-foreground', missingRequired && 'text-destructive')}>
                            {missingRequired
                                ? tPrompts('advanced.preview.missingRequiredBadge', {
                                      names: model.missingRequiredInputNames.join(', '),
                                  })
                                : currentSceneHtml.trim()
                                  ? ''
                                  : tSceneOperation('emptySceneHint')}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button type="button" variant="ghost" onClick={handleDismiss}>
                                {tCommon('cancel')}
                            </Button>
                            {(generating || runAbortRef.current !== null) && (
                                <Button type="button" variant="outline" onClick={handleTerminate}>
                                    {tSceneOperation('terminate')}
                                </Button>
                            )}
                            {activeTab === 'tweak' && (
                                <Button
                                    type="button"
                                    disabled={!canGenerate}
                                    onClick={() => void startRun({ closeOnStart: true })}
                                    className="min-w-[8rem] gap-2"
                                >
                                    {generating && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {tCommon('generate')}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
