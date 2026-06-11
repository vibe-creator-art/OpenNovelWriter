'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    ArrowLeft,
    ChevronDown,
    ChevronUp,
    FileText,
    Loader2,
    Pencil,
    Search,
    Trash2,
    Upload,
    X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { useInfoPanelStore } from '@/components/editor/info-panel-store'
import { materialApi, ApiError, type Material, type MaterialSummary } from '@/lib/api'

interface RightPanelMaterialsProps {
    novelId?: string
}

function stripExtension(filename: string): string {
    return filename.replace(/\.[^./\\]+$/, '')
}

export function RightPanelMaterials({ novelId }: RightPanelMaterialsProps) {
    const t = useTranslations('editor')

    const [materials, setMaterials] = useState<MaterialSummary[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [importing, setImporting] = useState(false)

    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [pendingDelete, setPendingDelete] = useState<MaterialSummary | null>(null)

    // The open doc id is kept in the shared store (per novel) so it survives this
    // component unmounting when the user switches tabs and comes back.
    const materialsOpenId = useInfoPanelStore((s) => s.materialsOpenId)
    const setMaterialsOpenId = useInfoPanelStore((s) => s.setMaterialsOpenId)
    const openId = novelId ? (materialsOpenId[novelId] ?? null) : null
    const [openDoc, setOpenDoc] = useState<Material | null>(null)
    const [loadingDoc, setLoadingDoc] = useState(false)

    const fileInputRef = useRef<HTMLInputElement>(null)

    const loadList = useCallback(async () => {
        if (!novelId) return
        setLoading(true)
        setError(null)
        try {
            const items = await materialApi.list(novelId)
            setMaterials(items)
        } catch (e) {
            console.error('Failed to load materials:', e)
            setError(t('infoPanel.materials.loadError'))
        } finally {
            setLoading(false)
        }
    }, [novelId, t])

    useEffect(() => {
        void loadList()
    }, [loadList])

    const handlePickFiles = () => fileInputRef.current?.click()

    const handleImport = useCallback(
        async (fileList: FileList | null) => {
            if (!novelId || !fileList || fileList.length === 0) return
            setImporting(true)
            setError(null)
            try {
                const files = Array.from(fileList)
                for (const file of files) {
                    const content = await file.text()
                    await materialApi.create(novelId, {
                        name: stripExtension(file.name),
                        content,
                    })
                }
                await loadList()
            } catch (e) {
                console.error('Failed to import materials:', e)
                setError(t('infoPanel.materials.importError'))
            } finally {
                setImporting(false)
                if (fileInputRef.current) fileInputRef.current.value = ''
            }
        },
        [novelId, loadList, t]
    )

    const startRename = (material: MaterialSummary) => {
        setRenamingId(material.id)
        setRenameValue(material.name)
    }

    const commitRename = useCallback(
        async (id: string) => {
            const name = renameValue.trim()
            setRenamingId(null)
            const target = materials.find((m) => m.id === id)
            if (!target || name === '' || name === target.name) return
            // Optimistic update
            setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, name } : m)))
            try {
                await materialApi.update(id, { name })
            } catch (e) {
                console.error('Failed to rename material:', e)
                await loadList()
            }
        },
        [renameValue, materials, loadList]
    )

    const confirmDelete = useCallback(async () => {
        if (!pendingDelete) return
        const id = pendingDelete.id
        setPendingDelete(null)
        setMaterials((prev) => prev.filter((m) => m.id !== id))
        if (openId === id && novelId) {
            setMaterialsOpenId(novelId, null)
        }
        try {
            await materialApi.delete(id)
        } catch (e) {
            console.error('Failed to delete material:', e)
            await loadList()
        }
    }, [pendingDelete, openId, novelId, setMaterialsOpenId, loadList])

    const openMaterial = useCallback(
        (id: string) => {
            if (novelId) setMaterialsOpenId(novelId, id)
        },
        [novelId, setMaterialsOpenId]
    )

    const closeMaterial = useCallback(() => {
        if (novelId) setMaterialsOpenId(novelId, null)
    }, [novelId, setMaterialsOpenId])

    // Load the open doc's full content whenever the open id changes — this fires
    // both when the user clicks a row and when the tab remounts with a remembered id.
    useEffect(() => {
        if (!openId) {
            setOpenDoc(null)
            return
        }
        let cancelled = false
        setOpenDoc(null)
        setLoadingDoc(true)
        setError(null)
        materialApi
            .get(openId)
            .then((doc) => {
                if (!cancelled) setOpenDoc(doc)
            })
            .catch((e) => {
                if (cancelled) return
                console.error('Failed to load material:', e)
                if (e instanceof ApiError && e.status === 404) {
                    if (novelId) setMaterialsOpenId(novelId, null)
                    void loadList()
                } else {
                    setError(t('infoPanel.materials.docLoadError'))
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingDoc(false)
            })
        return () => {
            cancelled = true
        }
    }, [openId, novelId, setMaterialsOpenId, loadList, t])

    if (!novelId) {
        return (
            <div className="p-4">
                <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                    {t('infoPanel.materials.noNovel')}
                </div>
            </div>
        )
    }

    if (openId) {
        return (
            <MaterialReader
                key={openId}
                materialId={openId}
                doc={openDoc}
                loading={loadingDoc}
                error={error}
                onBack={closeMaterial}
            />
        )
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.markdown,text/plain"
                multiple
                className="hidden"
                onChange={(e) => void handleImport(e.target.files)}
            />

            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                    {t('infoPanel.tabs.materials')}
                </span>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={handlePickFiles} disabled={importing}>
                    {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {t('infoPanel.materials.importLabel')}
                </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
                {error && (
                    <div className="px-3 py-2 text-xs text-destructive">{error}</div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                ) : materials.length === 0 ? (
                    <div className="p-4">
                        <div className="rounded-md border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                            {t('infoPanel.materials.empty')}
                        </div>
                    </div>
                ) : (
                    <ul className="py-1">
                        {materials.map((material) => (
                            <li
                                key={material.id}
                                className="group flex items-center gap-1 px-2 py-0.5"
                            >
                                {renamingId === material.id ? (
                                    <Input
                                        autoFocus
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        onBlur={() => void commitRename(material.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                void commitRename(material.id)
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault()
                                                setRenamingId(null)
                                            }
                                        }}
                                        className="h-7 text-sm"
                                    />
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => void openMaterial(material.id)}
                                            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-accent"
                                            title={material.name}
                                        >
                                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate">
                                                {material.name || t('infoPanel.materials.untitled')}
                                            </span>
                                        </button>
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                                            title={t('infoPanel.materials.rename')}
                                            onClick={() => startRename(material)}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                                            title={t('infoPanel.materials.delete')}
                                            onClick={() => setPendingDelete(material)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </ScrollArea>

            <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('infoPanel.materials.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('infoPanel.materials.deleteConfirmDescription', { name: pendingDelete?.name ?? '' })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('infoPanel.materials.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => void confirmDelete()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {t('infoPanel.materials.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

interface MaterialReaderProps {
    materialId: string
    doc: Material | null
    loading: boolean
    error: string | null
    onBack: () => void
}

function MaterialReader({
    materialId,
    doc,
    loading,
    error,
    onBack,
}: MaterialReaderProps) {
    const t = useTranslations('editor')
    const scrollRef = useRef<HTMLDivElement>(null)
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const restoredRef = useRef(false)

    const [query, setQuery] = useState('')
    const [currentMatch, setCurrentMatch] = useState(0)

    // Compute highlighted segments + match count for the search query.
    const { nodes, matchCount } = useMemo(() => {
        const text = doc?.content ?? ''
        const q = query.trim()
        if (!q) return { nodes: text as React.ReactNode, matchCount: 0 }

        const lower = text.toLowerCase()
        const needle = q.toLowerCase()
        const parts: React.ReactNode[] = []
        let from = 0
        let idx = lower.indexOf(needle, from)
        let count = 0
        while (idx !== -1) {
            if (idx > from) parts.push(text.slice(from, idx))
            const matchIdx = count
            parts.push(
                <mark
                    key={`m-${idx}`}
                    data-match-index={matchIdx}
                    className={cn(
                        'rounded-sm',
                        matchIdx === currentMatch
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-yellow-300/60 text-foreground dark:bg-yellow-500/40'
                    )}
                >
                    {text.slice(idx, idx + q.length)}
                </mark>
            )
            from = idx + q.length
            count += 1
            idx = lower.indexOf(needle, from)
        }
        if (from < text.length) parts.push(text.slice(from))
        return { nodes: parts as React.ReactNode, matchCount: count }
    }, [doc?.content, query, currentMatch])

    // Restore last read position once content is available.
    useEffect(() => {
        if (!doc || restoredRef.current) return
        restoredRef.current = true
        const el = scrollRef.current
        if (!el) return
        const ratio = doc.readPosition ?? 0
        requestAnimationFrame(() => {
            const max = el.scrollHeight - el.clientHeight
            if (max > 0) el.scrollTop = ratio * max
        })
    }, [doc])

    const updateQuery = useCallback((value: string) => {
        setQuery(value)
        setCurrentMatch(0)
    }, [])

    // Scroll the active match into view.
    useEffect(() => {
        const el = scrollRef.current
        if (!el || !query.trim()) return
        const mark = el.querySelector(`mark[data-match-index="${currentMatch}"]`)
        if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, [currentMatch, query, nodes])

    const persistPosition = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const max = el.scrollHeight - el.clientHeight
        const ratio = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0
        materialApi.update(materialId, { readPosition: ratio }).catch((e) => {
            console.error('Failed to save read position:', e)
        })
    }, [materialId])

    const handleScroll = useCallback(() => {
        if (!restoredRef.current) return
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(persistPosition, 600)
    }, [persistPosition])

    // Flush a pending save when leaving the reader.
    useEffect(() => {
        return () => {
            if (saveTimer.current) {
                clearTimeout(saveTimer.current)
                persistPosition()
            }
        }
    }, [persistPosition])

    const gotoMatch = (delta: number) => {
        if (matchCount === 0) return
        setCurrentMatch((prev) => (prev + delta + matchCount) % matchCount)
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
                <Button
                    size="icon-sm"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={onBack}
                    title={t('infoPanel.materials.back')}
                    aria-label={t('infoPanel.materials.back')}
                >
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(e) => updateQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                gotoMatch(e.shiftKey ? -1 : 1)
                            }
                        }}
                        placeholder={t('infoPanel.materials.searchPlaceholder')}
                        className="h-7 pl-7 pr-7 text-sm"
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => updateQuery('')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label={t('infoPanel.materials.clearSearch')}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                {query.trim() && (
                    <>
                        <span className="shrink-0 px-1 text-xs tabular-nums text-muted-foreground">
                            {matchCount === 0
                                ? t('infoPanel.materials.noMatch')
                                : `${currentMatch + 1}/${matchCount}`}
                        </span>
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            disabled={matchCount === 0}
                            onClick={() => gotoMatch(-1)}
                            title={t('infoPanel.materials.prevMatch')}
                        >
                            <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            disabled={matchCount === 0}
                            onClick={() => gotoMatch(1)}
                            title={t('infoPanel.materials.nextMatch')}
                        >
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                    </>
                )}
            </div>

            <div className="truncate border-b px-3 py-1 text-xs font-medium text-muted-foreground">
                {doc?.name || t('infoPanel.materials.untitled')}
            </div>

            <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-auto">
                {loading ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                ) : error ? (
                    <div className="px-3 py-2 text-xs text-destructive">{error}</div>
                ) : (
                    <pre className="whitespace-pre-wrap break-words px-4 py-3 font-sans text-sm leading-relaxed text-foreground">
                        {nodes}
                    </pre>
                )}
            </div>
        </div>
    )
}
