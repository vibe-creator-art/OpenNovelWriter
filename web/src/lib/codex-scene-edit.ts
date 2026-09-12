export type SceneEditHunk = { id: string; beforeText: string; afterText: string }
export type SceneEditToolResult = {
    sceneId: string
    chapterId: string
    actNumber: number
    applied: SceneEditHunk[]
    failedCount: number
}

export function findSceneEditPayload(value: unknown, depth = 0): SceneEditToolResult | null {
    if (!value || depth > 6) return null
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (Array.isArray(record.applied) && typeof record.sceneId === 'string') {
            const applied = (record.applied as unknown[])
                .map((item) => {
                    const hunk = item as Record<string, unknown>
                    if (typeof hunk?.id !== 'string') return null
                    return {
                        id: hunk.id,
                        beforeText: typeof hunk.beforeText === 'string' ? hunk.beforeText : '',
                        afterText: typeof hunk.afterText === 'string' ? hunk.afterText : '',
                    }
                })
                .filter((item): item is SceneEditHunk => item !== null)
            if (applied.length === 0) return null
            return {
                sceneId: record.sceneId,
                chapterId: typeof record.chapterId === 'string' ? record.chapterId : '',
                actNumber: typeof record.actNumber === 'number' ? record.actNumber : 1,
                applied,
                failedCount: typeof record.failedCount === 'number' ? record.failedCount : 0,
            }
        }
        for (const child of Object.values(record)) {
            const found = findSceneEditPayload(child, depth + 1)
            if (found) return found
        }
        return null
    }
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
        try {
            return findSceneEditPayload(JSON.parse(trimmed), depth + 1)
        } catch {
            return null
        }
    }
    return null
}

