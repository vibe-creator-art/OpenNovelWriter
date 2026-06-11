'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Undo2, X, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSceneEditsStore } from '@/components/editor/scene-edits-store'
import type { SceneEdit } from '@/lib/api'
import type { WriteNavTarget } from '@/components/editor/plan-view'

function HunkDiff({ edit }: { edit: SceneEdit }) {
    return (
        <div className="text-xs leading-5">
            {edit.beforeText.trim() && (
                <div className="whitespace-pre-wrap break-words rounded bg-rose-500/10 px-2 py-1 text-rose-700 line-through dark:text-rose-300">
                    {edit.beforeText}
                </div>
            )}
            {edit.afterText.trim() && (
                <div className="mt-1 whitespace-pre-wrap break-words rounded bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                    {edit.afterText}
                </div>
            )}
        </div>
    )
}

// Per-scene review block, rendered above a scene editor when Codex has pending edits there.
export function SceneReviewPanel({ novelId, sceneId }: { novelId: string; sceneId: string }) {
    const allEdits = useSceneEditsStore((state) => state.edits)
    const resolve = useSceneEditsStore((state) => state.resolve)
    const resolveAll = useSceneEditsStore((state) => state.resolveAll)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [collapsed, setCollapsed] = useState(false)

    const edits = useMemo(() => allEdits.filter((edit) => edit.sceneId === sceneId), [allEdits, sceneId])
    if (edits.length === 0) return null

    const handleResolve = async (editId: string, action: 'accept' | 'reject') => {
        const result = await resolve(novelId, editId, action)
        if (!result.ok) {
            setErrors((prev) => ({ ...prev, [editId]: result.error ?? '操作失败' }))
        }
    }

    return (
        <div className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.05] p-3">
            <div className="flex items-center gap-2">
                <Pencil className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="min-w-0 flex-1 text-xs font-medium text-foreground">
                    Codex 改写了本场景 · {edits.length} 处待审
                </span>
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => resolveAll(novelId, 'accept-all', sceneId)}>
                    <Check className="h-3 w-3" /> 全部接受
                </Button>
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => resolveAll(novelId, 'reject-all', sceneId)}>
                    <Undo2 className="h-3 w-3" /> 全部撤销
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setCollapsed((value) => !value)}>
                    {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </Button>
            </div>
            {!collapsed && (
                <div className="mt-2 space-y-2">
                    {edits.map((edit) => (
                        <div key={edit.id} className="rounded-lg border bg-background/60 p-2">
                            <HunkDiff edit={edit} />
                            <div className="mt-1.5 flex items-center gap-2">
                                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => handleResolve(edit.id, 'accept')}>
                                    <Check className="h-3 w-3" /> 接受
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => handleResolve(edit.id, 'reject')}>
                                    <Undo2 className="h-3 w-3" /> 撤销
                                </Button>
                                {errors[edit.id] && <span className="text-[11px] text-rose-600">{errors[edit.id]}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// Novel-level floating toolbar: jump between pending edits and bulk accept/reject.
export function ManuscriptReviewToolbar({
    novelId,
    chapterOrder,
    onNavigate,
}: {
    novelId: string
    chapterOrder: { id: string; actNumber: number }[]
    onNavigate: (target: WriteNavTarget) => void
}) {
    const edits = useSceneEditsStore((state) => state.edits)
    const resolveAll = useSceneEditsStore((state) => state.resolveAll)
    const [cursor, setCursor] = useState(0)
    const [confirming, setConfirming] = useState<'accept-all' | 'reject-all' | null>(null)
    const [busy, setBusy] = useState(false)

    // Unique scenes with pending edits, in manuscript reading order.
    const targets = useMemo(() => {
        const chapterRank = new Map(chapterOrder.map((chapter, index) => [chapter.id, index]))
        const seen = new Map<string, { chapterId: string; sceneId: string }>()
        for (const edit of edits) {
            if (!seen.has(edit.sceneId)) seen.set(edit.sceneId, { chapterId: edit.chapterId, sceneId: edit.sceneId })
        }
        return [...seen.values()].sort((left, right) => {
            const leftRank = chapterRank.get(left.chapterId) ?? Number.MAX_SAFE_INTEGER
            const rightRank = chapterRank.get(right.chapterId) ?? Number.MAX_SAFE_INTEGER
            return leftRank - rightRank
        })
    }, [edits, chapterOrder])

    if (edits.length === 0 || targets.length === 0) return null

    const jump = (next: number) => {
        const index = ((next % targets.length) + targets.length) % targets.length
        setCursor(index)
        const target = targets[index]
        onNavigate({ kind: 'scene', chapterId: target.chapterId, sceneId: target.sceneId })
    }

    const runResolveAll = async (action: 'accept-all' | 'reject-all') => {
        setBusy(true)
        try {
            await resolveAll(novelId, action)
        } finally {
            setBusy(false)
            setConfirming(null)
        }
    }

    return (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur">
            {confirming ? (
                <div className="flex items-center gap-1 text-xs">
                    <span className="px-2 font-medium text-foreground">
                        {confirming === 'accept-all' ? '接受' : '撤销'}本小说全部 {edits.length} 处改动？
                    </span>
                    <Button
                        size="sm"
                        variant="ghost"
                        className={cn('h-7 gap-1 px-2', confirming === 'accept-all' ? 'text-emerald-600' : 'text-rose-600')}
                        disabled={busy}
                        onClick={() => runResolveAll(confirming)}
                    >
                        {confirming === 'accept-all' ? <Check className="h-3.5 w-3.5" /> : <Undo2 className="h-3.5 w-3.5" />}
                        确认
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => setConfirming(null)}>
                        取消
                    </Button>
                </div>
            ) : (
                <div className="flex items-center gap-1 text-xs">
                    <span className="px-2 font-medium text-foreground">
                        {edits.length} 处 AI 改动 · {targets.length} 个场景
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="上一处" onClick={() => jump(cursor - 1)}>
                        <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="下一处" onClick={() => jump(cursor + 1)}>
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                    <div className="mx-1 h-4 w-px bg-border" />
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" title="接受本小说全部改动" onClick={() => setConfirming('accept-all')}>
                        <Check className="h-3.5 w-3.5" /> 全部接受
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" title="撤销本小说全部改动" onClick={() => setConfirming('reject-all')}>
                        <X className="h-3.5 w-3.5" /> 全部撤销
                    </Button>
                </div>
            )}
        </div>
    )
}
