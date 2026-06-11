'use client'

type CursorMemory = {
    version: 1
    cursorPosBySceneId: Record<string, number>
    lastSceneIdByChapterId: Record<string, string>
    lastSceneId: string | null
}

const STORAGE_VERSION = 1 as const
const STORAGE_PREFIX = 'onw-write-cursor-memory:'

const memoryCache = new Map<string, CursorMemory>()
const pendingSaveTimers = new Map<string, number>()

function storageKey(novelId: string) {
    return `${STORAGE_PREFIX}${novelId}`
}

function normalizeMemory(raw: unknown): CursorMemory {
    if (!raw || typeof raw !== 'object') {
        return {
            version: STORAGE_VERSION,
            cursorPosBySceneId: {},
            lastSceneIdByChapterId: {},
            lastSceneId: null,
        }
    }

    const record = raw as Partial<CursorMemory>
    if (record.version !== STORAGE_VERSION) {
        return {
            version: STORAGE_VERSION,
            cursorPosBySceneId: {},
            lastSceneIdByChapterId: {},
            lastSceneId: null,
        }
    }

    return {
        version: STORAGE_VERSION,
        cursorPosBySceneId: record.cursorPosBySceneId ?? {},
        lastSceneIdByChapterId: record.lastSceneIdByChapterId ?? {},
        lastSceneId: typeof record.lastSceneId === 'string' && record.lastSceneId.trim() ? record.lastSceneId : null,
    }
}

function loadMemory(novelId: string): CursorMemory {
    if (memoryCache.has(novelId)) return memoryCache.get(novelId)!

    let parsed: unknown = null
    try {
        parsed = JSON.parse(localStorage.getItem(storageKey(novelId)) ?? 'null')
    } catch {
        parsed = null
    }

    const memory = normalizeMemory(parsed)
    memoryCache.set(novelId, memory)
    return memory
}

function saveMemory(novelId: string) {
    const memory = memoryCache.get(novelId)
    if (!memory) return
    try {
        localStorage.setItem(storageKey(novelId), JSON.stringify(memory))
    } catch {
        // Ignore storage write errors (private mode/quota)
    }
}

function scheduleSave(novelId: string) {
    const existing = pendingSaveTimers.get(novelId)
    if (existing) window.clearTimeout(existing)
    const timer = window.setTimeout(() => {
        pendingSaveTimers.delete(novelId)
        saveMemory(novelId)
    }, 600)
    pendingSaveTimers.set(novelId, timer)
}

export function setSceneCursorMemory(params: { novelId: string; chapterId: string; sceneId: string; cursorPos: number }) {
    const { novelId, chapterId, sceneId, cursorPos } = params
    if (!novelId || !chapterId || !sceneId) return
    if (!Number.isFinite(cursorPos)) return

    const memory = loadMemory(novelId)
    memory.cursorPosBySceneId[sceneId] = cursorPos
    memory.lastSceneIdByChapterId[chapterId] = sceneId
    memory.lastSceneId = sceneId
    scheduleSave(novelId)
}

export function getRememberedSceneIdForChapter(novelId: string, chapterId: string): string | null {
    if (!novelId || !chapterId) return null
    const memory = loadMemory(novelId)
    return memory.lastSceneIdByChapterId[chapterId] ?? null
}

export function getRememberedCursorPosForScene(novelId: string, sceneId: string): number | null {
    if (!novelId || !sceneId) return null
    const memory = loadMemory(novelId)
    const pos = memory.cursorPosBySceneId[sceneId]
    return Number.isFinite(pos) ? pos : null
}

export function getLastRememberedSceneId(novelId: string): string | null {
    if (!novelId) return null
    const memory = loadMemory(novelId)
    return memory.lastSceneId ?? null
}
