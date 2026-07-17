'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react'

import { skillApi, type Skill, type SkillFileTreeNode } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

type SkillDirectoryBrowserDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    skill: Skill | null
}

function collectDirectoryPaths(nodes: SkillFileTreeNode[], paths = new Set<string>()) {
    for (const node of nodes) {
        if (node.type !== 'directory') continue
        paths.add(node.path)
        collectDirectoryPaths(node.children ?? [], paths)
    }
    return paths
}

function findInitialFile(nodes: SkillFileTreeNode[]): SkillFileTreeNode | null {
    const skillFile = nodes.find((node) => node.type === 'file' && node.path === 'SKILL.md' && node.previewable)
    if (skillFile) return skillFile
    for (const node of nodes) {
        if (node.type === 'file' && node.previewable) return node
        if (node.type === 'directory') {
            const nested = findInitialFile(node.children ?? [])
            if (nested) return nested
        }
    }
    return null
}

export function SkillDirectoryBrowserDialog({ open, onOpenChange, skill }: SkillDirectoryBrowserDialogProps) {
    const t = useTranslations('skills.directory')
    const [files, setFiles] = useState<SkillFileTreeNode[]>([])
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [content, setContent] = useState('')
    const [loading, setLoading] = useState(false)
    const [fileLoading, setFileLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const readFile = useCallback(async (file: SkillFileTreeNode) => {
        if (!skill || file.type !== 'file') return
        setSelectedPath(file.path)
        setContent('')
        if (!file.previewable) {
            setError(t('notPreviewable'))
            return
        }
        setFileLoading(true)
        setError(null)
        try {
            const result = await skillApi.readFile(skill.id, file.path)
            setContent(result.content)
        } catch (readError) {
            setError(readError instanceof Error ? readError.message : t('loadFailed'))
        } finally {
            setFileLoading(false)
        }
    }, [skill, t])

    useEffect(() => {
        if (!open || !skill) return
        let cancelled = false
        setFiles([])
        setSelectedPath(null)
        setContent('')
        setError(null)
        setLoading(true)
        void (async () => {
            try {
                const result = await skillApi.listFiles(skill.id)
                if (cancelled) return
                setFiles(result.files)
                setExpanded(collectDirectoryPaths(result.files))
                const initial = findInitialFile(result.files)
                if (initial) await readFile(initial)
            } catch (loadError) {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [open, readFile, skill, t])

    const selectedName = useMemo(() => selectedPath?.split('/').pop() ?? null, [selectedPath])

    const renderNodes = (nodes: SkillFileTreeNode[], depth = 0) => nodes.map((node) => {
        if (node.type === 'directory') {
            const isExpanded = expanded.has(node.path)
            return (
                <div key={node.path}>
                    <button
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-muted"
                        style={{ paddingLeft: 8 + depth * 16 }}
                        onClick={() => setExpanded((current) => {
                            const next = new Set(current)
                            if (next.has(node.path)) next.delete(node.path)
                            else next.add(node.path)
                            return next
                        })}
                    >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {isExpanded ? <FolderOpen className="h-4 w-4 text-muted-foreground" /> : <Folder className="h-4 w-4 text-muted-foreground" />}
                        <span className="truncate">{node.name}</span>
                    </button>
                    {isExpanded ? renderNodes(node.children ?? [], depth + 1) : null}
                </div>
            )
        }

        return (
            <button
                key={node.path}
                type="button"
                className={cn(
                    'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-muted',
                    selectedPath === node.path && 'bg-muted font-medium',
                    !node.previewable && 'text-muted-foreground'
                )}
                style={{ paddingLeft: 24 + depth * 16 }}
                onClick={() => void readFile(node)}
            >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{node.name}</span>
            </button>
        )
    })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex h-[82vh] flex-col gap-0 overflow-hidden p-0"
                style={{ width: 'calc(100vw - 16px)', maxWidth: 1440 }}
            >
                <DialogHeader className="border-b px-5 py-4">
                    <DialogTitle>{t('title', { name: skill?.name ?? '' })}</DialogTitle>
                    <DialogDescription>{t('description')}</DialogDescription>
                </DialogHeader>
                <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
                    <div className="min-h-0 border-r bg-muted/20">
                        <ScrollArea className="h-full">
                            <div className="p-2">
                                {loading ? <div className="p-2 text-sm text-muted-foreground">{t('loading')}</div> : renderNodes(files)}
                            </div>
                        </ScrollArea>
                    </div>
                    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                        <div className="h-10 border-b px-4 py-2 text-sm font-medium text-muted-foreground">
                            {selectedPath ?? t('selectFile')}
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                            <div className="min-h-full p-4">
                                {fileLoading ? (
                                    <div className="text-sm text-muted-foreground">{t('loading')}</div>
                                ) : error ? (
                                    <div className="text-sm text-destructive">{error}</div>
                                ) : selectedName ? (
                                    <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6">{content}</pre>
                                ) : (
                                    <div className="text-sm text-muted-foreground">{t('selectFile')}</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
