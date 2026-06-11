'use client'

import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'

import { ApiError, promptApi, type Prompt } from '@/lib/api'
import {
    flattenIncludesInText,
    parsePromptBundleFromText,
    serializePromptBundle,
    serializePromptBundleJson,
    type PromptBundleV1,
    type PromptBundlePromptV1,
} from '@/lib/prompt-bundle'
import type { PromptCategory } from '@/lib/prompts'

import {
    coerceCategory,
    downloadTextFile,
    normalizeKey,
    toPromptBundlePrompt,
    toSafeFilenameSegment,
    type BundlePromptSource,
    type PromptDraft,
    type PromptTranslateFn,
} from '@/components/editor/prompts/middle-panel-prompts-shared'
import { analyzeClipboardExport, analyzeClipboardImport } from '@/components/editor/prompts/prompt-analysis'

export function usePromptClipboard(params: {
    prompts: Prompt[]
    draft: PromptDraft | null
    setPrompts: React.Dispatch<React.SetStateAction<Prompt[]>>
    setError: React.Dispatch<React.SetStateAction<string | null>>
    setActiveCategory: React.Dispatch<React.SetStateAction<PromptCategory>>
    setExpandedCategories: React.Dispatch<React.SetStateAction<Record<PromptCategory, boolean>>>
    setSelectedPromptId: React.Dispatch<React.SetStateAction<string | null>>
    componentContentByNameKey: Map<string, string>
    componentPromptByNameKey: Map<string, BundlePromptSource>
    onPromptChanged: () => void
    t: PromptTranslateFn
}) {
    const {
        prompts,
        draft,
        setPrompts,
        setError,
        setActiveCategory,
        setExpandedCategories,
        setSelectedPromptId,
        componentContentByNameKey,
        componentPromptByNameKey,
        onPromptChanged,
        t,
    } = params

    const [clipboardExportOpen, setClipboardExportOpen] = useState(false)
    const [clipboardExportFormat, setClipboardExportFormat] = useState<'flatten' | 'bundle' | 'as_is'>('bundle')
    const [clipboardExportBusy, setClipboardExportBusy] = useState(false)
    const [clipboardExportError, setClipboardExportError] = useState<string | null>(null)

    const [clipboardImportOpen, setClipboardImportOpen] = useState(false)
    const [clipboardImportText, setClipboardImportText] = useState('')
    const [clipboardImportBundle, setClipboardImportBundle] = useState<PromptBundleV1 | null>(null)
    const [clipboardImportMode, setClipboardImportMode] = useState<'entry_only' | 'all'>('all')
    const [clipboardImportBusy, setClipboardImportBusy] = useState(false)
    const [clipboardImportError, setClipboardImportError] = useState<string | null>(null)
    const [clipboardImportOverwriteConfirmOpen, setClipboardImportOverwriteConfirmOpen] = useState(false)
    const promptBundleJsonImportInputRef = useRef<HTMLInputElement | null>(null)

    const clipboardExportAnalysis = useMemo(
        () => analyzeClipboardExport(draft, componentContentByNameKey, componentPromptByNameKey),
        [componentContentByNameKey, componentPromptByNameKey, draft]
    )

    const clipboardImportAnalysis = useMemo(
        () => analyzeClipboardImport(clipboardImportBundle),
        [clipboardImportBundle]
    )

    const clipboardImportConflictNames = useMemo(() => {
        if (!clipboardImportBundle) return []

        const entryKey = normalizeKey(clipboardImportBundle.entryName)
        const entryPrompt = clipboardImportBundle.prompts.find((prompt) => normalizeKey(prompt.name) === entryKey) ?? null
        const promptsToImport = clipboardImportMode === 'entry_only' && entryPrompt ? [entryPrompt] : clipboardImportBundle.prompts
        const existingNameKeys = new Set(prompts.map((prompt) => normalizeKey(prompt.name ?? '')))

        return promptsToImport
            .map((prompt) => prompt.name.trim())
            .filter((name) => {
                const key = normalizeKey(name)
                return key && existingNameKeys.has(key)
            })
    }, [clipboardImportBundle, clipboardImportMode, prompts])

    const performClipboardExport = useCallback(async (format: 'flatten' | 'bundle' | 'as_is') => {
        if (!draft) return

        setClipboardExportBusy(true)
        setClipboardExportError(null)
        try {
            const entry = toPromptBundlePrompt(draft)
            if (!entry) throw new Error(t('clipboard.errors.invalidPrompt'))

            const entryKey = normalizeKey(entry.name)
            const dependencyPrompts = clipboardExportAnalysis.dependencyPrompts
                .map((prompt) => toPromptBundlePrompt(prompt))
                .filter((prompt): prompt is PromptBundlePromptV1 => Boolean(prompt))
                .filter((prompt) => normalizeKey(prompt.name) !== entryKey)

            let promptsForBundle: PromptBundlePromptV1[] = [entry]

            if (format === 'bundle') {
                promptsForBundle = [entry, ...dependencyPrompts]
            }

            if (format === 'flatten') {
                if (
                    clipboardExportAnalysis.flattenMissingIncludes.length > 0 ||
                    clipboardExportAnalysis.flattenCycles.length > 0 ||
                    clipboardExportAnalysis.flattenDepthExceeded
                ) {
                    throw new Error(t('clipboard.errors.flattenUnavailable'))
                }

                const resolveInclude = (name: string) => {
                    const key = normalizeKey(name ?? '')
                    if (!key) return null
                    return componentContentByNameKey.get(key) ?? null
                }

                const flattened: PromptBundlePromptV1 = {
                    ...entry,
                    messages: (entry.messages ?? []).map((message) => {
                        const result = flattenIncludesInText({ text: message.content ?? '', resolveInclude, maxDepth: 10 })
                        return { ...message, content: result.text }
                    }),
                }
                promptsForBundle = [flattened]
            }

            await navigator.clipboard.writeText(serializePromptBundle({
                schema: 'open-novel-writer/prompt-bundle',
                version: 1,
                exportedAt: new Date().toISOString(),
                entryName: entry.name,
                prompts: promptsForBundle,
            }))
            setClipboardExportOpen(false)
        } catch (error) {
            console.error(error)
            const detail = error instanceof Error ? error.message : ''
            setClipboardExportError(detail || t('clipboard.errors.copyFailed'))
        } finally {
            setClipboardExportBusy(false)
        }
    }, [clipboardExportAnalysis, componentContentByNameKey, draft, t])

    const handleCopyPromptToClipboard = useCallback(async () => {
        if (!draft) return
        setClipboardExportError(null)
        if ((clipboardExportAnalysis.directIncludes?.length ?? 0) === 0) {
            await performClipboardExport('as_is')
            return
        }
        setClipboardExportFormat('bundle')
        setClipboardExportOpen(true)
    }, [clipboardExportAnalysis.directIncludes?.length, draft, performClipboardExport])

    const handleExportPromptToJson = useCallback(async () => {
        if (!draft) return
        try {
            setError(null)
            const entry = toPromptBundlePrompt(draft)
            if (!entry) throw new Error(t('clipboard.errors.invalidPrompt'))

            const entryKey = normalizeKey(entry.name)
            const dependencyPrompts = clipboardExportAnalysis.dependencyPrompts
                .map((prompt) => toPromptBundlePrompt(prompt))
                .filter((prompt): prompt is PromptBundlePromptV1 => Boolean(prompt))
                .filter((prompt) => normalizeKey(prompt.name) !== entryKey)

            const exportedAt = new Date().toISOString()
            const dateTag = exportedAt.slice(0, 10)
            const filename = `${toSafeFilenameSegment(entry.name)}-prompt-bundle-${dateTag}.json`

            downloadTextFile({
                filename,
                content: serializePromptBundleJson({
                    schema: 'open-novel-writer/prompt-bundle',
                    version: 1,
                    exportedAt,
                    entryName: entry.name,
                    prompts: [entry, ...dependencyPrompts],
                }),
                mimeType: 'application/json',
            })
        } catch (error) {
            console.error(error)
            const detail = error instanceof Error ? error.message : ''
            setError(detail || t('clipboard.errors.downloadFailed'))
        }
    }, [clipboardExportAnalysis.dependencyPrompts, draft, setError, t])

    const handleOpenClipboardImport = useCallback(async () => {
        setClipboardImportError(null)
        setClipboardImportBundle(null)
        setClipboardImportMode('all')
        setClipboardImportOpen(true)
        try {
            const text = await navigator.clipboard.readText()
            setClipboardImportText(text)
        } catch (error) {
            console.error(error)
        }
    }, [])

    const parseAndSetPromptBundleImport = useCallback((text: string) => {
        setClipboardImportError(null)
        const parsed = parsePromptBundleFromText(text)
        if (!parsed.ok) {
            setClipboardImportError(parsed.detail)
            return
        }

        const entryKey = normalizeKey(parsed.bundle.entryName)
        const entry = parsed.bundle.prompts.find((prompt) => normalizeKey(prompt.name) === entryKey) ?? null
        if (!entry) {
            setClipboardImportError(t('clipboard.errors.missingEntry'))
            return
        }

        setClipboardImportMode(parsed.bundle.prompts.length > 1 ? 'all' : 'entry_only')
        setClipboardImportBundle(parsed.bundle)
    }, [t])

    const handleParseClipboardImport = useCallback(() => {
        parseAndSetPromptBundleImport(clipboardImportText)
    }, [clipboardImportText, parseAndSetPromptBundleImport])

    const handleOpenJsonImport = useCallback(() => {
        setClipboardImportError(null)
        setClipboardImportBundle(null)
        setClipboardImportMode('all')
        setClipboardImportText('')
        setClipboardImportOpen(true)
        promptBundleJsonImportInputRef.current?.click()
    }, [])

    const handleJsonImportFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0] ?? null
        event.target.value = ''
        if (!file) return

        setClipboardImportError(null)
        setClipboardImportBundle(null)
        setClipboardImportMode('all')
        setClipboardImportOpen(true)

        try {
            const text = await file.text()
            setClipboardImportText(text)
            parseAndSetPromptBundleImport(text)
        } catch (error) {
            console.error(error)
            setClipboardImportError(t('clipboard.errors.readFileFailed'))
        }
    }, [parseAndSetPromptBundleImport, t])

    const runClipboardImport = useCallback(async (overwriteExisting: boolean) => {
        if (!clipboardImportBundle) return
        setClipboardImportBusy(true)
        setClipboardImportError(null)

        try {
            const entryKey = normalizeKey(clipboardImportBundle.entryName)
            const entryPrompt = clipboardImportBundle.prompts.find((prompt) => normalizeKey(prompt.name) === entryKey) ?? null
            if (!entryPrompt) throw new Error(t('clipboard.errors.missingEntry'))

            const promptsToImport = clipboardImportMode === 'entry_only' ? [entryPrompt] : clipboardImportBundle.prompts
            const payload = {
                prompts: promptsToImport.map((prompt) => ({
                    name: (prompt.name ?? '').trim(),
                    category: prompt.category,
                    description: prompt.description ?? null,
                    messages: prompt.messages ?? [],
                    inputs: prompt.inputs ?? [],
                    isNsfw: prompt.isNsfw === true,
                    modelGroupIds: prompt.modelGroupIds ?? [],
                    modelSetIds: prompt.modelSetIds ?? [],
                    allowLlmCall: prompt.allowLlmCall === true,
                    allowAgentCall: prompt.allowAgentCall === true,
                    agentCallMode: prompt.agentCallMode ?? 'generate_then_agent',
                })),
                overwriteExisting,
            }

            const { prompts: importedPrompts } = await promptApi.import(payload)
            const importedIds = new Set(importedPrompts.map((prompt) => prompt.id))
            setPrompts((prev) => [...importedPrompts, ...prev.filter((prompt) => !importedIds.has(prompt.id))])
            onPromptChanged()

            const entryImported = importedPrompts.find((prompt) => normalizeKey(prompt.name) === entryKey) ?? null
            if (entryImported) {
                const category = coerceCategory(String(entryImported.category))
                if (category) {
                    setExpandedCategories((prev) => ({ ...prev, [category]: true }))
                    setActiveCategory(category)
                }
                setSelectedPromptId(entryImported.id)
            }

            setClipboardImportOverwriteConfirmOpen(false)
            setClipboardImportOpen(false)
        } catch (error) {
            if (error instanceof ApiError) {
                const data = error.data as
                    | { code?: unknown; names?: unknown; detail?: unknown }
                    | undefined

                const namesFromData = Array.isArray(data?.names)
                    ? data.names.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
                    : null

                const namesFromMessage = (() => {
                    const prefix = 'Prompt name already exists:'
                    if (typeof error.message !== 'string' || !error.message.startsWith(prefix)) return null
                    const rest = error.message.slice(prefix.length).trim()
                    return rest || null
                })()

                if (error.status === 409 && (data?.code === 'PROMPT_NAME_ALREADY_EXISTS' || namesFromData || namesFromMessage)) {
                    const namesText = namesFromData ? namesFromData.join(', ') : namesFromMessage ?? ''
                    setClipboardImportError(t('clipboard.errors.nameAlreadyExists', { names: namesText }))
                    return
                }

                if (error.status === 400 && data?.code === 'PROMPT_BUNDLE_DUPLICATE_NAMES') {
                    const namesText = namesFromData ? namesFromData.join(', ') : ''
                    setClipboardImportError(t('clipboard.errors.duplicateNamesInBundle', { names: namesText }))
                    return
                }

                setClipboardImportError(error.message || t('clipboard.errors.importFailed'))
                return
            }

            console.error(error)
            const detail = error instanceof Error ? error.message : ''
            setClipboardImportError(detail || t('clipboard.errors.importFailed'))
        } finally {
            setClipboardImportBusy(false)
        }
    }, [clipboardImportBundle, clipboardImportMode, onPromptChanged, setActiveCategory, setExpandedCategories, setPrompts, setSelectedPromptId, t])

    const handleRunClipboardImport = useCallback(async () => {
        if (clipboardImportConflictNames.length > 0) {
            setClipboardImportOverwriteConfirmOpen(true)
            return
        }

        await runClipboardImport(false)
    }, [clipboardImportConflictNames.length, runClipboardImport])

    const handleConfirmClipboardImportOverwrite = useCallback(async () => {
        await runClipboardImport(true)
    }, [runClipboardImport])

    const handleResetClipboardImportDialog = useCallback(() => {
        setClipboardImportError(null)
        setClipboardImportBundle(null)
        setClipboardImportBusy(false)
        setClipboardImportOverwriteConfirmOpen(false)
    }, [])

    const handleBackFromClipboardImportPreview = useCallback(() => {
        setClipboardImportBundle(null)
    }, [])

    return {
        clipboardExportOpen,
        setClipboardExportOpen,
        clipboardExportFormat,
        setClipboardExportFormat,
        clipboardExportBusy,
        clipboardExportError,
        setClipboardExportError,
        clipboardImportOpen,
        setClipboardImportOpen,
        clipboardImportText,
        setClipboardImportText,
        clipboardImportBundle,
        clipboardImportMode,
        setClipboardImportMode,
        clipboardImportBusy,
        clipboardImportError,
        clipboardImportOverwriteConfirmOpen,
        setClipboardImportOverwriteConfirmOpen,
        promptBundleJsonImportInputRef,
        clipboardExportAnalysis,
        clipboardImportAnalysis,
        clipboardImportConflictNames,
        performClipboardExport,
        handleCopyPromptToClipboard,
        handleExportPromptToJson,
        handleOpenClipboardImport,
        handleParseClipboardImport,
        handleOpenJsonImport,
        handleJsonImportFileSelected,
        handleRunClipboardImport,
        handleConfirmClipboardImportOverwrite,
        handleResetClipboardImportDialog,
        handleBackFromClipboardImportPreview,
    }
}
