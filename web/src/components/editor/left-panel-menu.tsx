'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { LeftPanelTerms } from '@/components/editor/left-panel-terms'
import { LeftPanelSnippets } from '@/components/editor/left-panel-snippets'
import { LeftPanelChapterOutline } from '@/components/editor/left-panel-chapter-outline'
import { LeftPanelChats } from '@/components/editor/left-panel-chats'
import { LeftPanelCodex } from '@/components/editor/left-panel-codex'
import type { TermEntryPanelTab } from '@/components/editor/terms/term-entry-events'
import {
    ChevronDown,
    ChevronRight,
    ClipboardList,
    FileText,
    BookOpen,
    PanelLeftClose,
    MessageSquare,
    Bot,
    Sparkles,
    Search,
} from 'lucide-react'
import { ChapterWithScenes } from '@/lib/api'

interface LeftPanelMenuProps {
    sidebarWidth: number
    sidebarTab: 'outline' | 'codex' | 'chapterOutline' | 'term' | 'snippets' | 'chats'
    novelId?: string
    requestedOpenSnippetId?: string | null
    onRequestedOpenSnippetHandled?: () => void
    requestedOpenTermEntry?: { entryId: string; tab?: TermEntryPanelTab } | null
    onRequestedOpenTermEntryHandled?: () => void
    requestedOpenOutlineTarget?: { kind: 'act'; actNumber: number } | { kind: 'chapter'; chapterId: string } | null
    onRequestedOpenOutlineHandled?: () => void
    chapters: ChapterWithScenes[]
    actNumbers: number[]
    expandedActs: Set<number>
    chaptersByAct: Record<number, ChapterWithScenes[]>
    actWordCounts: Record<number, number>
    selectedChapterId: string | null
    editingChapterId: string | null
    editingActNumber: number | null
    // Callbacks
    onSidebarClose: () => void
    onSidebarTabChange: (tab: 'outline' | 'codex' | 'chapterOutline' | 'term' | 'snippets' | 'chats') => void
    onToggleAct: (actNumber: number) => void
    onChapterClick: (chapter: ChapterWithScenes, actNumber: number) => void
    onNavigateToManuscript: (chapterId: string, sceneId?: string, termId?: string, target?: 'manuscript' | 'summary') => void
    onNavigateToSnippet: (snippetId: string) => void
    onNavigateToOutline: (target: { kind: 'act'; actNumber: number } | { kind: 'chapter'; chapterId: string }) => void
    onStartResize: (e: React.MouseEvent) => void
    getActDisplayTitle: (actNumber: number) => string
    getGlobalChapterIndex: (chapterId: string) => number
}

export function LeftPanelMenu({
    sidebarWidth,
    sidebarTab,
    novelId,
    requestedOpenSnippetId,
    onRequestedOpenSnippetHandled,
    requestedOpenTermEntry,
    onRequestedOpenTermEntryHandled,
    requestedOpenOutlineTarget,
    onRequestedOpenOutlineHandled,
    chapters,
    actNumbers,
    expandedActs,
    chaptersByAct,
    actWordCounts,
    selectedChapterId,
    editingChapterId,
    editingActNumber,
    onSidebarClose,
    onSidebarTabChange,
    onToggleAct,
    onChapterClick,
    onNavigateToManuscript,
    onNavigateToSnippet,
    onNavigateToOutline,
    onStartResize,
    getActDisplayTitle,
    getGlobalChapterIndex,
}: LeftPanelMenuProps) {
    const t = useTranslations('editor')
    const [searchQuery, setSearchQuery] = useState('')
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const isSearching = normalizedQuery.length > 0

    const chaptersByActToRender = useMemo(() => {
        if (!isSearching) return chaptersByAct

        const filtered: Record<number, ChapterWithScenes[]> = {}
        actNumbers.forEach((actNumber) => {
            const chaptersInAct = chaptersByAct[actNumber] || []
            const matchedChapters = chaptersInAct.filter((chapter) =>
                chapter.title.toLowerCase().includes(normalizedQuery)
            )
            if (matchedChapters.length > 0) {
                filtered[actNumber] = matchedChapters
            }
        })
        return filtered
    }, [actNumbers, chaptersByAct, isSearching, normalizedQuery])

    const actNumbersToRender = useMemo(() => {
        if (!isSearching) return actNumbers
        return actNumbers.filter((actNumber) => (chaptersByActToRender[actNumber] || []).length > 0)
    }, [actNumbers, chaptersByActToRender, isSearching])

    const isCompact = sidebarWidth < 260
    const showTabLabels = sidebarWidth >= 220
    const showCodexLabel = sidebarWidth >= 250

    return (
        <>
            <aside
                className="border-r bg-card shrink-0 flex flex-col overflow-hidden"
                style={{ width: sidebarWidth }}
            >
                <div className="border-b">
                    <div className="grid grid-cols-4">
                        {[
                            {
                                id: 'outline' as const,
                                label: t('sidebar.outline'),
                                icon: <FileText className="h-4 w-4" />,
                            },
                            {
                                id: 'term' as const,
                                label: t('sidebar.term'),
                                icon: <BookOpen className="h-4 w-4" />,
                            },
                            {
                                id: 'snippets' as const,
                                label: t('sidebar.snippets'),
                                icon: <Sparkles className="h-4 w-4" />,
                            },
                            {
                                id: 'chats' as const,
                                label: t('sidebar.chats'),
                                icon: <MessageSquare className="h-4 w-4" />,
                            },
                        ].map((tab) => (
                            <Button
                                key={tab.id}
                                variant="ghost"
                                size="sm"
                                className={`w-full rounded-none text-xs gap-1 px-1 ${sidebarTab === tab.id ? 'border-b-2 border-primary' : ''}`}
                                onClick={() => onSidebarTabChange(tab.id)}
                                title={tab.label}
                            >
                                {tab.icon}
                                {showTabLabels && <span className="truncate">{tab.label}</span>}
                            </Button>
                        ))}

                        <Button
                            variant="ghost"
                            size="sm"
                            className={`w-full rounded-none text-xs gap-0.5 px-0.5 ${sidebarTab === 'codex' ? 'border-b-2 border-primary' : ''}`}
                            onClick={() => onSidebarTabChange('codex')}
                            title={t('sidebar.codex')}
                        >
                            <Bot className="h-4 w-4" />
                            {showCodexLabel && <span className="shrink-0">{t('sidebar.codex')}</span>}
                        </Button>

                        <Button
                            variant="ghost"
                            size="sm"
                            className={`w-full rounded-none text-xs gap-1 px-1 ${sidebarTab === 'chapterOutline' ? 'border-b-2 border-primary' : ''}`}
                            onClick={() => onSidebarTabChange('chapterOutline')}
                            title={t('sidebar.chapterOutline')}
                        >
                            <ClipboardList className="h-4 w-4" />
                            {showTabLabels && <span className="truncate">{t('sidebar.chapterOutline')}</span>}
                        </Button>

                        <div className="h-8 w-full" />

                        <Button
                            variant="ghost"
                            size="icon-sm"
                            className="w-full rounded-none"
                            onClick={onSidebarClose}
                            title={t('sidebar.collapse')}
                            aria-label={t('sidebar.collapse')}
                        >
                            <PanelLeftClose className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {sidebarTab === 'outline' && (
                    <>
                        <div className="p-2 border-b">
                            <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder={isCompact ? t('sidebar.searchCompact') : t('sidebar.search')}
                                    className="pl-8 h-8 text-sm"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                />
                            </div>
                        </div>

                        <ScrollArea className="flex-1 min-h-0">
                            <div className="p-2">
                                {actNumbersToRender.map((actNum) => {
                                    const isActExpanded = isSearching || expandedActs.has(actNum)
                                    return (
                                        <div key={actNum} className="mb-2">
                                            <button
                                                onClick={() => {
                                                    if (!isSearching) {
                                                        onToggleAct(actNum)
                                                    }
                                                }}
                                                className={`w-full flex items-center gap-1 px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted rounded transition-colors
                                                    ${editingActNumber === actNum ? 'ring-[3px] ring-gray-300 bg-gray-50' : ''}`}
                                            >
                                                {isActExpanded ? (
                                                    <ChevronDown className="h-3 w-3" />
                                                ) : (
                                                    <ChevronRight className="h-3 w-3" />
                                                )}
                                                <span
                                                    className={editingActNumber === actNum ? 'text-primary font-medium' : ''}
                                                >
                                                    {getActDisplayTitle(actNum)}
                                                </span>
                                                <Badge variant="secondary" className="ml-auto text-xs h-5">
                                                    {actWordCounts[actNum] || 0}
                                                </Badge>
                                            </button>

                                            {isActExpanded &&
                                                (chaptersByActToRender[actNum] || []).map((chapter) => (
                                                    <div
                                                        key={chapter.id}
                                                        className={`group flex items-center gap-2 px-2 py-1.5 ml-3 rounded text-sm cursor-pointer transition-colors
                                                            ${selectedChapterId === chapter.id
                                                                ? 'bg-muted ring-1 ring-primary/50'
                                                                : 'hover:bg-muted'}
                                                            ${editingChapterId === chapter.id
                                                                ? 'ring-[3px] ring-gray-300 bg-gray-50'
                                                                : ''}`}
                                                        onClick={() => onChapterClick(chapter, actNum)}
                                                    >
                                                        <span
                                                            className={`h-6 w-6 flex items-center justify-center text-xs shrink-0 rounded
                                                                ${selectedChapterId === chapter.id
                                                                    ? 'bg-foreground text-background font-medium'
                                                                    : 'bg-muted text-muted-foreground'}`}
                                                        >
                                                            {getGlobalChapterIndex(chapter.id)}
                                                        </span>

                                                        <span
                                                            className={`truncate flex-1 ${editingChapterId === chapter.id ? 'text-primary font-medium' : ''}`}
                                                        >
                                                            {chapter.title}
                                                        </span>

                                                        <span className="text-xs text-muted-foreground shrink-0">
                                                            {chapter.wordCount}
                                                        </span>
                                                    </div>
                                                ))}
                                        </div>
                                    )
                                })}
                                {chapters.length === 0 && (
                                    <div className="text-center py-8 text-muted-foreground text-sm">
                                        {t('sidebar.noChapters')}
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </>
                )}

                {sidebarTab === 'chapterOutline' && (
                    <LeftPanelChapterOutline
                        key={novelId ?? 'default'}
                        novelId={novelId}
                        isCompact={isCompact}
                        chapters={chapters}
                        actNumbers={actNumbers}
                        expandedActs={expandedActs}
                        chaptersByAct={chaptersByAct}
                        onToggleAct={onToggleAct}
                        getActDisplayTitle={getActDisplayTitle}
                        getGlobalChapterIndex={getGlobalChapterIndex}
                        requestedOpenOutlineTarget={requestedOpenOutlineTarget}
                        onRequestedOpenOutlineHandled={onRequestedOpenOutlineHandled}
                    />
                )}

                {sidebarTab === 'codex' && (
                    <LeftPanelCodex
                        novelId={novelId}
                        isCompact={isCompact}
                        onOpenCodex={() => onSidebarTabChange('codex')}
                    />
                )}

                {sidebarTab === 'term' && (
                    <LeftPanelTerms
                        key={novelId ?? 'default'}
                        novelId={novelId}
                        isCompact={isCompact}
                        chapters={chapters}
                        requestedOpenEntry={requestedOpenTermEntry}
                        onRequestedOpenEntryHandled={onRequestedOpenTermEntryHandled}
                        onNavigateToManuscript={onNavigateToManuscript}
                        onNavigateToSnippet={onNavigateToSnippet}
                        onNavigateToOutline={onNavigateToOutline}
                    />
                )}

                {sidebarTab === 'snippets' && (
                    <LeftPanelSnippets
                        key={novelId ?? 'default'}
                        novelId={novelId}
                        isCompact={isCompact}
                        requestedOpenSnippetId={requestedOpenSnippetId}
                        onRequestedOpenSnippetHandled={onRequestedOpenSnippetHandled}
                    />
                )}

                {sidebarTab === 'chats' && (
                    <LeftPanelChats
                        novelId={novelId}
                        isCompact={isCompact}
                    />
                )}

            </aside>

            <div
                className="w-1 hover:bg-primary/20 cursor-col-resize shrink-0 transition-colors"
                onMouseDown={onStartResize}
            />
        </>
    )
}
