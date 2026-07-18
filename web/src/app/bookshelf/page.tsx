'use client'

import { useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { actApi, Novel, novelApi, sceneApi, snippetApi, termsApi, chapterApi, uploadApi } from '@/lib/api'
import { useAuthStore, useSettingsStore } from '@/lib/store'
import { NovelCard } from '@/components/novel-card'
import { NovelFormDialog } from '@/components/novel-form-dialog'
import { NovelLoadingOverlay } from '@/components/novel-loading-overlay'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { importNovelCrafterProject } from '@/lib/novelcrafter-import'
import {
    parseSillyTavernCard,
    buildSillyTavernImport,
    type ParsedTavernCard,
    type TavernMacroOptions,
} from '@/lib/sillytavern-import'
import { Plus, LogOut, BookOpen, Settings, ChevronDown, Import, Loader2 } from 'lucide-react'
import { SettingsDialog } from '@/components/settings-dialog'
import { TavernImportDialog } from '@/components/tavern-import-dialog'

export default function BookshelfPage() {
    const router = useRouter()
    const { token, user, logout, isHydrated } = useAuthStore()
    const fastNovelOpen = useSettingsStore((s) => s.fastNovelOpen)
    const [novels, setNovels] = useState<Novel[]>([])
    const [loading, setLoading] = useState(true)
    const [formOpen, setFormOpen] = useState(false)
    const [editingNovel, setEditingNovel] = useState<Novel | null>(null)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const [deletingNovel, setDeletingNovel] = useState<Novel | null>(null)
    const [importing, setImporting] = useState(false)
    const [importError, setImportError] = useState<string | null>(null)

    // Loading overlay state
    const [loadingOverlayVisible, setLoadingOverlayVisible] = useState(false)
    const [loadingNovelTitle, setLoadingNovelTitle] = useState<string | undefined>()

    // Settings dialog state
    const [settingsOpen, setSettingsOpen] = useState(false)
    const importInputRef = useRef<HTMLInputElement | null>(null)
    const tavernImportInputRef = useRef<HTMLInputElement | null>(null)
    const [tavernCard, setTavernCard] = useState<ParsedTavernCard | null>(null)
    const [tavernDialogOpen, setTavernDialogOpen] = useState(false)
    const [tavernCardSeq, setTavernCardSeq] = useState(0)
    const directoryPickerProps: Record<string, string> = {
        webkitdirectory: '',
        directory: '',
    }

    // Translations
    const t = useTranslations('bookshelf')
    const tAuth = useTranslations('auth')
    const tCommon = useTranslations('common')
    const locale = useLocale()
    const defaultNovelLanguage = locale?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'

    useEffect(() => {
        // Wait for hydration, then redirect to login if no token
        if (isHydrated && !token) {
            router.replace('/login')
        }
    }, [token, isHydrated, router])

    const loadNovels = useCallback(async () => {
        try {
            const data = await novelApi.list()
            setNovels(data)
        } catch (error: unknown) {
            // If we get a 401 (Not authenticated), the token is invalid - logout and redirect
            if (error && typeof error === 'object' && 'status' in error && error.status === 401) {
                logout()
                router.replace('/login')
                return
            }
            // Only log non-auth errors
            console.error('Failed to load novels:', error)
        } finally {
            setLoading(false)
        }
    }, [logout, router])

    useEffect(() => {
        // Only load novels after the store has finished rehydrating
        // and we have a valid token
        if (isHydrated && token) {
            loadNovels()
        }
    }, [token, isHydrated, loadNovels])

    const handleCreate = async (data: { title: string; description?: string; category?: string; coverImage?: string; coverCrop?: string | null }) => {
        const novel = await novelApi.create({ ...data, language: defaultNovelLanguage })
        setNovels((prev) => [novel, ...prev])
    }

    const handleEdit = async (data: { title: string; description?: string; category?: string; coverImage?: string; coverCrop?: string | null }) => {
        if (!editingNovel) return
        const updated = await novelApi.update(editingNovel.id, data)
        setNovels((prev) => prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)))
    }

    const handleDelete = async () => {
        if (!deletingNovel) return
        await novelApi.delete(deletingNovel.id)
        setNovels((prev) => prev.filter((n) => n.id !== deletingNovel.id))
        setDeleteConfirmOpen(false)
        setDeletingNovel(null)
    }

    const handleLogout = () => {
        logout()
        router.replace('/login')
    }

    const handleNovelClick = (novel: Novel) => {
        setLoadingNovelTitle(novel.title)
        setLoadingOverlayVisible(true)

        // The overlay still shows while the editor loads. The delay below only
        // exists to fully reveal the animation; "fast open" skips it and lets
        // navigation start immediately.
        if (fastNovelOpen) {
            router.push(`/editor/${novel.id}`)
            return
        }

        // Navigate after a short delay to show the animation
        setTimeout(() => {
            router.push(`/editor/${novel.id}`)
        }, 800)
    }

    const openCreateDialog = () => {
        setEditingNovel(null)
        setFormOpen(true)
    }

    const handleImportNovelCrafter = () => {
        if (importing) return
        setImportError(null)
        if (importInputRef.current) {
            importInputRef.current.value = ''
            importInputRef.current.click()
        }
    }

    const handleImportInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length === 0) return

        setImporting(true)
        setImportError(null)

        let createdNovel: Novel | null = null

        try {
            const imported = await importNovelCrafterProject(files, {
                invalidProject: t('importErrors.invalidProject'),
                missingImportContent: t('importErrors.missingImportContent'),
            })

            const novel = await novelApi.create({
                title: imported.novelTitle,
                language: defaultNovelLanguage,
            })
            createdNovel = novel

            if (imported.authorName) {
                await novelApi.update(novel.id, { authorName: imported.authorName })
            }

            await termsApi.saveState(novel.id, imported.termState)
            await Promise.all(
                imported.snippets.map((snippet) =>
                    snippetApi.create(novel.id, {
                        title: snippet.title,
                        content: snippet.content,
                        pinned: snippet.pinned,
                    })
                )
            )
            await Promise.all(
                imported.manuscript.acts.map((act) =>
                    actApi.upsert(novel.id, {
                        number: act.number,
                        title: act.title,
                    })
                )
            )
            for (const chapter of imported.manuscript.chapters) {
                const firstScene = chapter.scenes[0]
                const createdChapter = await chapterApi.create(novel.id, {
                    title: chapter.title,
                    actNumber: chapter.actNumber,
                    order: chapter.order,
                    content: firstScene?.contentHtml ?? '',
                })

                const defaultScene = createdChapter.scenes?.[0]
                if (defaultScene) {
                    await sceneApi.update(defaultScene.id, {
                        content: firstScene?.contentHtml ?? '',
                        summary: firstScene?.summary,
                    })
                }

                for (const scene of chapter.scenes.slice(1)) {
                    const createdScene = await sceneApi.create(createdChapter.id)
                    await sceneApi.update(createdScene.id, {
                        content: scene.contentHtml,
                        summary: scene.summary,
                    })
                }
            }
            setNovels((prev) => [novel, ...prev])
        } catch (error) {
            if (createdNovel) {
                try {
                    await novelApi.delete(createdNovel.id)
                } catch (cleanupError) {
                    console.error('Failed to rollback imported novel:', cleanupError)
                }
            }
            console.error('Failed to import NovelCrafter project:', error)
            setImportError(error instanceof Error ? error.message : tCommon('operationFailed'))
        } finally {
            setImporting(false)
        }
    }

    const handleImportTavernCard = () => {
        if (importing) return
        setImportError(null)
        if (tavernImportInputRef.current) {
            tavernImportInputRef.current.value = ''
            tavernImportInputRef.current.click()
        }
    }

    const runTavernImport = async (card: ParsedTavernCard, options: TavernMacroOptions) => {
        setImporting(true)
        setImportError(null)

        let createdNovel: Novel | null = null

        try {
            const imported = buildSillyTavernImport(card, options, {
                firstChapterTitle: t('tavernImport.firstChapterTitle'),
                characterProfileTitle: t('tavernImport.characterProfileTitle'),
                descriptionLabel: t('tavernImport.descriptionLabel'),
                personalityLabel: t('tavernImport.personalityLabel'),
                scenarioLabel: t('tavernImport.scenarioLabel'),
                loreFallbackTitle: t('tavernImport.loreFallbackTitle'),
            })

            // The card image is the cover. Cover upload failures are non-fatal.
            let coverImage: string | undefined
            try {
                const uploaded = await uploadApi.image(card.coverFile)
                coverImage = uploaded.url
            } catch (coverError) {
                console.error('Failed to upload tavern card cover:', coverError)
            }

            const novel = await novelApi.create({
                title: imported.novelTitle,
                language: defaultNovelLanguage,
                coverImage,
            })
            createdNovel = novel

            if (imported.termState.entries.length > 0) {
                await termsApi.saveState(novel.id, imported.termState)
            }

            if (imported.snippet) {
                await snippetApi.create(novel.id, {
                    title: imported.snippet.title,
                    content: imported.snippet.content,
                    pinned: true,
                })
            }

            const createdChapter = await chapterApi.create(novel.id, {
                title: imported.firstChapter.title,
                actNumber: 1,
                order: 1,
                content: imported.firstChapter.contentHtml,
            })
            const defaultScene = createdChapter.scenes?.[0]
            if (defaultScene) {
                await sceneApi.update(defaultScene.id, {
                    content: imported.firstChapter.contentHtml,
                })
            }

            setNovels((prev) => [novel, ...prev])
        } catch (error) {
            if (createdNovel) {
                try {
                    await novelApi.delete(createdNovel.id)
                } catch (cleanupError) {
                    console.error('Failed to rollback imported tavern novel:', cleanupError)
                }
            }
            console.error('Failed to import tavern card:', error)
            setImportError(error instanceof Error ? error.message : tCommon('operationFailed'))
        } finally {
            setImporting(false)
        }
    }

    const handleTavernInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        setImportError(null)

        let card: ParsedTavernCard
        try {
            card = await parseSillyTavernCard(file, {
                invalidCard: t('importErrors.invalidTavernCard'),
            })
        } catch (error) {
            console.error('Failed to parse tavern card:', error)
            setImportError(error instanceof Error ? error.message : tCommon('operationFailed'))
            return
        }

        if (card.hasCharMacro || card.hasUserMacro) {
            setTavernCard(card)
            setTavernCardSeq((seq) => seq + 1)
            setTavernDialogOpen(true)
            return
        }

        await runTavernImport(card, { char: 'keep', user: 'keep' })
    }

    const handleTavernDialogConfirm = async (options: TavernMacroOptions) => {
        const card = tavernCard
        setTavernDialogOpen(false)
        setTavernCard(null)
        if (card) {
            await runTavernImport(card, options)
        }
    }

    const renderPrimaryActions = () => (
        <div className="flex items-center gap-3">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={importing}>
                        {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Import className="h-4 w-4 mr-2" />}
                        {importing ? t('importing') : t('importNovel')}
                        <ChevronDown className="h-4 w-4 ml-2" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={handleImportNovelCrafter} disabled={importing}>
                        {t('importOptions.fromNovelCrafter')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={handleImportTavernCard} disabled={importing}>
                        {t('importOptions.fromTavernCard')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                {t('createNovel')}
            </Button>
        </div>
    )

    if (!isHydrated || !token) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-lg">{tCommon('loading')}</div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Loading Overlay */}
            <NovelLoadingOverlay
                isVisible={loadingOverlayVisible}
                novelTitle={loadingNovelTitle}
            />

            {/* Header */}
            <header className="border-b bg-card sticky top-0 z-10">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <BookOpen className="h-6 w-6 text-primary" />
                        <h1 className="text-xl font-bold">OpenNovelWriter</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-muted-foreground">
                            {t('welcome', { username: user?.username ?? '' })}
                        </span>
                        <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)}>
                            <Settings className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleLogout}>
                            <LogOut className="h-4 w-4 mr-2" />
                            {tAuth('logout')}
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="container mx-auto px-4 py-8">
                <div className="flex items-center justify-between mb-8">
                    <h2 className="text-2xl font-bold">{t('title')}</h2>
                    {renderPrimaryActions()}
                </div>

                <input
                    ref={importInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleImportInputChange}
                    {...directoryPickerProps}
                />

                <input
                    ref={tavernImportInputRef}
                    type="file"
                    accept="image/png"
                    className="hidden"
                    onChange={handleTavernInputChange}
                />

                {importError && (
                    <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                        {importError}
                    </div>
                )}

                {loading ? (
                    <div className="text-center py-12 text-muted-foreground">
                        {tCommon('loading')}
                    </div>
                ) : novels.length === 0 ? (
                    <div className="text-center py-12">
                        <BookOpen className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground mb-4">
                            {t('empty')}
                        </p>
                        {renderPrimaryActions()}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {novels.map((novel) => (
                            <NovelCard
                                key={novel.id}
                                novel={novel}
                                onClick={handleNovelClick}
                                onEdit={(n) => {
                                    setEditingNovel(n)
                                    setFormOpen(true)
                                }}
                                onDelete={(n) => {
                                    setDeletingNovel(n)
                                    setDeleteConfirmOpen(true)
                                }}
                            />
                        ))}
                    </div>
                )}
            </main>

            {/* Novel Form Dialog */}
            <NovelFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                novel={editingNovel}
                onSubmit={editingNovel ? handleEdit : handleCreate}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('deleteConfirm.title')}</DialogTitle>
                        <DialogDescription>
                            {t('deleteConfirm.description', { title: deletingNovel?.title ?? '' })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
                            {tCommon('cancel')}
                        </Button>
                        <Button variant="destructive" onClick={handleDelete}>
                            {tCommon('delete')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Settings Dialog */}
            <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

            {/* Tavern card macro options */}
            <TavernImportDialog
                key={tavernCardSeq}
                open={tavernDialogOpen}
                cardName={tavernCard?.data.name?.trim() || ''}
                hasCharMacro={Boolean(tavernCard?.hasCharMacro)}
                hasUserMacro={Boolean(tavernCard?.hasUserMacro)}
                onConfirm={handleTavernDialogConfirm}
                onOpenChange={(open) => {
                    if (!open) {
                        setTavernDialogOpen(false)
                        setTavernCard(null)
                    }
                }}
            />
        </div>
    )
}
