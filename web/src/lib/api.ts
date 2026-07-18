import { useAuthStore } from './store'
import type { ModelAssignment, ModelGroup, ModelSet, ModelSetMember } from '@/lib/ai-store'
import { DEFAULT_PROMPT_SELECTION_CATEGORIES, type DefaultPromptSelectionCategory } from './prompt-default-categories'
import type { PromptAgentCallMode, PromptCategory, PromptMessage } from './prompts'
import type { PromptInputDefinition } from './prompt-inputs'
import type { SkillCategory } from './skills'
import type { StoredTerms, TermEntryGalleryItem } from '@/components/editor/terms/types'
import type { RevisionHistoryItem } from '@/lib/revision-history'
import type { PromptBundleV1 } from './prompt-bundle'
import type { SkillPresetAssetV1 } from './skill-preset'

const API_BASE = '/api'

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public data?: unknown
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {},
    requiresAuth: boolean = true
): Promise<T> {
    const token = useAuthStore.getState().token

    // Check if authentication is required but no token is available
    if (requiresAuth && !token) {
        throw new ApiError(401, 'Not authenticated - no token available')
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    })

    if (!response.ok) {
        if (response.status === 401) {
            useAuthStore.getState().logout()
        }
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
        throw new ApiError(response.status, error.detail || 'Request failed', error)
    }

    return response.json()
}

// Auth API
export const authApi = {
    register: (data: { username: string; email: string; password: string }) =>
        fetchApi<{ access_token: string; user: { id: string; username: string; email: string } }>(
            '/auth/register',
            { method: 'POST', body: JSON.stringify(data) },
            false // No auth required for registration
        ),

    login: (data: { username: string; password: string }) =>
        fetchApi<{ access_token: string; user: { id: string; username: string; email: string } }>(
            '/auth/login',
            { method: 'POST', body: JSON.stringify(data) },
            false // No auth required for login
        ),

    me: () =>
        fetchApi<{ id: string; username: string; email: string }>('/auth/me'),
}

// Novel API
export interface Novel {
    id: string
    title: string
    description: string | null
    category: string | null
    coverImage: string | null
    coverCrop: string | null
    authorName: string | null
    series: string | null
    seriesIndex: number | null
    language: string | null
    outlineActSummaryCollapsesChapters: boolean
    codexSessionAutoCleanup: boolean
    codexSessionRetentionLimit: number
    ownerId: string
    createdAt: string
    updatedAt: string
    _count?: { chapters: number }
}

export const novelApi = {
    list: () => fetchApi<Novel[]>('/novels'),

    get: (id: string) => fetchApi<Novel & { chapters: ChapterWithScenes[] }>(`/novels/${id}`),

    create: (data: { title: string; description?: string; category?: string; coverImage?: string; coverCrop?: string | null; language?: string }) =>
        fetchApi<Novel>('/novels', { method: 'POST', body: JSON.stringify(data) }),

    update: (id: string, data: Partial<Novel>) =>
        fetchApi<Novel>(`/novels/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

    delete: (id: string) =>
        fetchApi<{ message: string }>(`/novels/${id}`, { method: 'DELETE' }),
}

export type NovelWritingDay = {
    dateKey: string
    netWordCount: number
    endingWordCount: number
}

export type NovelReviewData = {
    totalWordCount: number
    todayWordCount: number
    days: NovelWritingDay[]
}

export const novelReviewApi = {
    get: (novelId: string) => fetchApi<NovelReviewData>(`/novels/${novelId}/review`),
}

// Labels API
export interface NovelLabel {
    id: string
    name: string
    color: string | null
    sortOrder: number
    novelId: string
    createdAt: string
    updatedAt: string
}

export const labelApi = {
    list: (novelId: string) => fetchApi<NovelLabel[]>(`/novels/${novelId}/labels`),

    create: (novelId: string, data: { name: string }) =>
        fetchApi<NovelLabel>(`/novels/${novelId}/labels`, { method: 'POST', body: JSON.stringify(data) }),

    update: (novelId: string, labelId: string, data: { name?: string; sortOrder?: number; color?: string | null }) =>
        fetchApi<NovelLabel>(`/novels/${novelId}/labels/${labelId}`, { method: 'PUT', body: JSON.stringify(data) }),

    delete: (novelId: string, labelId: string) =>
        fetchApi<{ message: string }>(`/novels/${novelId}/labels/${labelId}`, { method: 'DELETE' }),
}

// Chapter API
export interface Chapter {
    id: string
    title: string
    actNumber: number
    order: number
    wordCount: number
    novelId: string
    createdAt: string
    updatedAt: string
}

export const chapterApi = {
    list: (novelId: string) => fetchApi<Chapter[]>(`/novels/${novelId}/chapters`),

    get: (id: string) => fetchApi<Chapter>(`/chapters/${id}`),

    create: (novelId: string, data: { title?: string; content?: string; actNumber?: number; order?: number }) =>
        fetchApi<ChapterWithScenes>(`/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify(data) }),

    update: (id: string, data: { title?: string; actNumber?: number; order?: number }) =>
        fetchApi<Chapter>(`/chapters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

    delete: (id: string) =>
        fetchApi<{ message: string }>(`/chapters/${id}`, { method: 'DELETE' }),

    reorder: (novelId: string, updates: { id: string; order: number; actNumber?: number }[]) =>
        fetchApi<Chapter[]>(`/novels/${novelId}/chapters/reorder`, {
            method: 'PATCH',
            body: JSON.stringify({ updates }),
        }),
}

// Scene API
export interface Scene {
    id: string
    order: number
    content: string
    summary: string | null
    wordCount: number
    labelIds: string[]
    termIds: string[]
    chapterId: string
    createdAt: string
    updatedAt: string
}

export interface ChapterWithScenes extends Chapter {
    scenes: Scene[]
}

export const sceneApi = {
    list: (chapterId: string) => fetchApi<Scene[]>(`/chapters/${chapterId}/scenes`),

    get: (id: string) => fetchApi<Scene>(`/scenes/${id}`),

    create: (chapterId: string) =>
        fetchApi<Scene>(`/chapters/${chapterId}/scenes`, { method: 'POST' }),

    update: (id: string, data: { content?: string; summary?: string; labelIds?: string[]; termIds?: string[] }) =>
        fetchApi<Scene>(`/scenes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

    delete: (id: string) =>
        fetchApi<{ message: string }>(`/scenes/${id}`, { method: 'DELETE' }),
}

// Act API
export interface Act {
    id: string
    number: number
    title: string | null
    summary: string | null
    labelIds: string[]
    novelId: string
    createdAt: string
    updatedAt: string
}

export const actApi = {
    list: (novelId: string) => fetchApi<Act[]>(`/novels/${novelId}/acts`),

    upsert: (novelId: string, data: { number: number; title?: string; summary?: string; labelIds?: string[] }) =>
        fetchApi<Act>(`/novels/${novelId}/acts`, { method: 'POST', body: JSON.stringify(data) }),

    delete: (novelId: string, actNumber: number) =>
        fetchApi<{ message: string }>(`/novels/${novelId}/acts/${actNumber}`, { method: 'DELETE' }),
}

// Snippets API
export interface Snippet {
    id: string
    title: string
    content: string
    pinned: boolean
    wordCount: number
    history?: RevisionHistoryItem[]
    novelId: string
    createdAt: string
    updatedAt: string
}

export const snippetApi = {
    list: (novelId: string) => fetchApi<Snippet[]>(`/novels/${novelId}/snippets`),

    create: (novelId: string, data?: { title?: string; content?: string; pinned?: boolean }) =>
        fetchApi<Snippet>(`/novels/${novelId}/snippets`, { method: 'POST', body: JSON.stringify(data ?? {}) }),

    get: (id: string) => fetchApi<Snippet>(`/snippets/${id}`),

    update: (id: string, data: Partial<Pick<Snippet, 'title' | 'content' | 'pinned'>>) =>
        fetchApi<Snippet>(`/snippets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

    delete: (id: string) =>
        fetchApi<{ message: string }>(`/snippets/${id}`, { method: 'DELETE' }),
}

// A read-only reference document attached to a novel. List responses omit `content`.
export interface MaterialSummary {
    id: string
    name: string
    readPosition: number
    order: number
    novelId: string
    createdAt: string
    updatedAt: string
}

export type Material = MaterialSummary & {
    content: string
}

export const materialApi = {
    list: (novelId: string) => fetchApi<MaterialSummary[]>(`/novels/${novelId}/materials`),

    create: (novelId: string, data: { name: string; content: string }) =>
        fetchApi<MaterialSummary>(`/novels/${novelId}/materials`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    get: (id: string) => fetchApi<Material>(`/materials/${id}`),

    update: (id: string, data: { name?: string; readPosition?: number }) =>
        fetchApi<MaterialSummary>(`/materials/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

    delete: (id: string) =>
        fetchApi<{ message: string }>(`/materials/${id}`, { method: 'DELETE' }),
}

// AI-proposed manuscript edits (one search/replace hunk each), pending author review.
export type SceneEditStatus = 'pending' | 'accepted' | 'rejected'

export interface SceneEdit {
    id: string
    novelId: string
    sceneId: string
    chapterId: string
    actNumber: number
    beforeText: string
    afterText: string
    anchorHash: string
    status: SceneEditStatus
    createdAt: string
}

export const sceneEditApi = {
    list: (novelId: string, status: 'pending' | 'accepted' | 'rejected' | 'all' = 'pending') =>
        fetchApi<SceneEdit[]>(`/novels/${novelId}/scene-edits?status=${status}`),

    statuses: (novelId: string, ids: string[]) =>
        fetchApi<{ statuses: { id: string; status: SceneEditStatus }[] }>(`/novels/${novelId}/scene-edits/statuses`, {
            method: 'POST',
            body: JSON.stringify({ ids }),
        }),

    resolve: (novelId: string, editId: string, action: 'accept' | 'reject') =>
        fetchApi<{ ok: boolean; status: SceneEditStatus }>(`/novels/${novelId}/scene-edits/${editId}`, {
            method: 'PATCH',
            body: JSON.stringify({ action }),
        }),

    resolveAll: (novelId: string, action: 'accept-all' | 'reject-all', sceneId?: string) =>
        fetchApi<{ ok: boolean; processed: number; failed: { id: string; error: string }[] }>(
            `/novels/${novelId}/scene-edits`,
            { method: 'POST', body: JSON.stringify({ action, sceneId }) }
        ),
}

export type OutlineType = 'ACT' | 'CHAPTER'

export type OutlineSummary = {
    id: string
    type: OutlineType
    actNumber: number | null
    chapterId: string | null
    wordCount: number
    novelId: string
    createdAt: string
    updatedAt: string
}

export type Outline = OutlineSummary & {
    content: string
    history?: RevisionHistoryItem[]
}

export type OutlineCreatePayload =
    | { type: 'ACT'; actNumber: number }
    | { type: 'CHAPTER'; chapterId: string }

export const outlineApi = {
    list: (novelId: string) => fetchApi<OutlineSummary[]>(`/novels/${novelId}/outlines`),

    create: (novelId: string, data: OutlineCreatePayload) =>
        fetchApi<OutlineSummary>(`/novels/${novelId}/outlines`, { method: 'POST', body: JSON.stringify(data) }),

    get: (id: string) => fetchApi<Outline>(`/outlines/${id}`),

    update: (id: string, data: Partial<Pick<Outline, 'content'>>) =>
        fetchApi<Outline>(`/outlines/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

    delete: (id: string) =>
        fetchApi<{ message: string }>(`/outlines/${id}`, { method: 'DELETE' }),

    deleteActOutline: (novelId: string, actNumber: number) =>
        fetchApi<{ message: string }>(`/novels/${novelId}/outlines/acts/${actNumber}`, { method: 'DELETE' }),

    remapActNumbers: (novelId: string, mapping: Record<number, number>) =>
        fetchApi<{ ok: true }>(`/novels/${novelId}/outlines/acts/remap`, {
            method: 'POST',
            body: JSON.stringify({ mapping }),
        }),
}

// Terms API (server-backed term state)
export type NovelTermsStateResponse = {
    exists: boolean
    state: StoredTerms
    updatedAt: string | null
}

export const termsApi = {
    getState: (novelId: string) => fetchApi<NovelTermsStateResponse>(`/novels/${novelId}/terms`),

    saveState: (novelId: string, state: StoredTerms) =>
        fetchApi<NovelTermsStateResponse>(`/novels/${novelId}/terms`, {
            method: 'PUT',
            body: JSON.stringify(state),
        }),

    addGalleryImage: (novelId: string, entryId: string, url: string) =>
        fetchApi<{ entryId: string; gallery: TermEntryGalleryItem[] }>(`/novels/${novelId}/terms/gallery`, {
            method: 'POST',
            body: JSON.stringify({ entryId, url }),
        }),
}

// Prompts API (cross-novel, synced to server)
export interface Prompt {
    id: string
    name: string
    category: PromptCategory | string
    description: string | null
    messages: PromptMessage[]
    inputs: PromptInputDefinition[]
    modelGroupIds: string[]
    modelSetIds: string[]
    allowLlmCall: boolean
    allowAgentCall: boolean
    agentCallMode: PromptAgentCallMode
    history?: RevisionHistoryItem[]
    isNsfw: boolean
    sortOrder: number
    sourcePresetId: string | null
    sourcePresetRevision: number | null
    ownerId: string
    createdAt: string
    updatedAt: string
}

export interface EditorChatMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    sentContent: string | null
    fullRenderedContent: string | null
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    termIds: string[]
    attachments: string[]
    createdAt: string
}

export interface EditorChatConversation {
    id: string
    title: string | null
    titleManuallyEdited: boolean
    promptId: string | null
    selectedGroupId: string | null
    draftContent: string
    promptSnapshot: Prompt | null
    inputState: unknown
    novelId: string
    ownerId: string
    createdAt: string
    updatedAt: string
    messages: EditorChatMessage[]
}

export interface Skill {
    id: string
    name: string
    description: string | null
    category: SkillCategory | string
    enabled: boolean
    prompt: string | null
    content: string
    sourcePresetId: string | null
    sourcePresetRevision: number | null
    createdAt: string
    updatedAt: string
}

export interface SkillFileTreeNode {
    name: string
    path: string
    type: 'directory' | 'file'
    size?: number
    previewable?: boolean
    children?: SkillFileTreeNode[]
}

export interface Agent {
    id: string
    name: string
    enabled: boolean
    content: string
    createdAt: string
    updatedAt: string
}

export const promptApi = {
    list: (params?: { category?: PromptCategory }) => {
        const query = params?.category ? `?category=${encodeURIComponent(params.category)}` : ''
        return fetchApi<{ prompts: Prompt[] }>(`/prompts${query}`)
    },

    create: (data: {
        name: string
        category: PromptCategory
        description?: string
        messages?: PromptMessage[]
        inputs?: PromptInputDefinition[]
        isNsfw?: boolean
        modelGroupIds?: string[]
        modelSetIds?: string[]
        allowLlmCall?: boolean
        allowAgentCall?: boolean
        agentCallMode?: PromptAgentCallMode
    }) =>
        fetchApi<{ prompt: Prompt }>('/prompts', {
            method: 'POST',
            body: JSON.stringify({
                name: data.name,
                category: data.category,
                description: data.description ?? null,
                messages: data.messages,
                inputs: data.inputs,
                isNsfw: data.isNsfw,
                modelGroupIds: data.modelGroupIds,
                modelSetIds: data.modelSetIds,
                allowLlmCall: data.allowLlmCall,
                allowAgentCall: data.allowAgentCall,
                agentCallMode: data.agentCallMode,
            }),
        }),

    update: (
        id: string,
        updates: Partial<{
            name: string
            category: PromptCategory
            description: string | null
            messages: PromptMessage[]
            inputs: PromptInputDefinition[]
            sortOrder: number
            isNsfw: boolean
            modelGroupIds: string[]
            modelSetIds: string[]
            allowLlmCall: boolean
            allowAgentCall: boolean
            agentCallMode: PromptAgentCallMode
        }>
    ) =>
        fetchApi<{ prompt: Prompt }>(`/prompts/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }),

    // Model bindings are user-local: this works even on preset-sourced (read-only) prompts.
    updateModelBindings: (id: string, bindings: { modelGroupIds?: string[]; modelSetIds?: string[] }) =>
        fetchApi<{ prompt: Prompt }>(`/prompts/${id}/model-bindings`, {
            method: 'PUT',
            body: JSON.stringify(bindings),
        }),

    delete: (id: string) =>
        fetchApi<{ ok: true }>(`/prompts/${id}`, { method: 'DELETE' }),

    clone: (id: string) =>
        fetchApi<{ prompt: Prompt }>(`/prompts/${id}/clone`, { method: 'POST' }),

    import: (data: {
        prompts: Array<{
            name: string
            category: PromptCategory
            description: string | null
            messages: PromptMessage[]
            inputs: PromptInputDefinition[]
            isNsfw?: boolean
            allowLlmCall?: boolean
            allowAgentCall?: boolean
            agentCallMode?: PromptAgentCallMode
        }>
        overwriteExisting?: boolean
    }) =>
        fetchApi<{ prompts: Prompt[] }>(`/prompts/import`, {
            method: 'POST',
            body: JSON.stringify(data),
    }),
}

export { DEFAULT_PROMPT_SELECTION_CATEGORIES }
export type { DefaultPromptSelectionCategory }

export type PromptDefaultSelection = {
    promptId: string
}

export interface BuiltinPromptPreset {
    presetId: string
    name: string
    description: string | null
    revision: number
    exportedAt: string
    promptCount: number
    promptCategories: Array<PromptCategory | string>
    entryPromptName: string
    entryPromptCategory: PromptCategory | string
}

export interface PromptPresetPublishResult {
    presetId: string
    revision: number
    preset: PromptPresetAssetV1
}

export interface PromptPresetAssetV1 {
    schema: 'open-novel-writer/prompt-preset'
    version: 1
    metadata: {
        presetId: string
        name: string
        description: string | null
        revision: number
        exportedAt: string
    }
    bundle: PromptBundleV1
}

export interface PromptPresetListResponse {
    authoringEnabled: boolean
    presets: BuiltinPromptPreset[]
}

export const promptDefaultsApi = {
    get: () =>
        fetchApi<{ defaults: Partial<Record<DefaultPromptSelectionCategory, PromptDefaultSelection>> }>('/prompt-defaults'),

    set: (category: DefaultPromptSelectionCategory, selection: PromptDefaultSelection | null) =>
        fetchApi<{ defaults: Partial<Record<DefaultPromptSelectionCategory, PromptDefaultSelection>> }>('/prompt-defaults', {
            method: 'PUT',
            body: JSON.stringify({
                category,
                promptId: selection?.promptId ?? null,
            }),
        }),
}

export const presetApi = {
    list: () => fetchApi<PromptPresetListResponse>('/presets'),

    get: (presetId: string) => fetchApi<{ preset: PromptPresetAssetV1 }>(`/presets/${encodeURIComponent(presetId)}`),

    clone: (presetId: string, data?: { overwriteExisting?: boolean }) =>
        fetchApi<{ presetId: string; prompts: Prompt[] }>(`/presets/${encodeURIComponent(presetId)}/clone`, {
            method: 'POST',
            body: JSON.stringify({
                ...(data?.overwriteExisting !== undefined ? { overwriteExisting: data.overwriteExisting } : {}),
            }),
        }),

    publish: (data: { promptId: string; presetId?: string; name: string; description?: string | null }) =>
        fetchApi<PromptPresetPublishResult>('/presets/publish', {
            method: 'POST',
            body: JSON.stringify({
                promptId: data.promptId,
                ...(data.presetId ? { presetId: data.presetId } : {}),
                name: data.name,
                description: data.description ?? null,
            }),
        }),

    update: (presetId: string, data: { promptId: string; name?: string; description?: string | null }) =>
        fetchApi<PromptPresetPublishResult>(`/presets/${encodeURIComponent(presetId)}`, {
            method: 'PUT',
            body: JSON.stringify({
                promptId: data.promptId,
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
            }),
        }),
}

export const skillApi = {
    list: (params?: { category?: SkillCategory }) => {
        const query = params?.category ? `?category=${encodeURIComponent(params.category)}` : ''
        return fetchApi<{ skills: Skill[] }>(`/skills${query}`)
    },

    get: (id: string) =>
        fetchApi<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}`),

    create: (data: { name: string; category: SkillCategory }) =>
        fetchApi<{ skill: Skill }>('/skills', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    clone: (id: string) =>
        fetchApi<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}/clone`, {
            method: 'POST',
        }),

    update: (id: string, data: { content: string; category: SkillCategory; prompt: string | null }) =>
        fetchApi<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    setEnabled: (id: string, enabled: boolean) =>
        fetchApi<{ skill: Skill }>(`/skills/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ enabled }),
        }),

    delete: (id: string) =>
        fetchApi<{ ok: true }>(`/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    listFiles: (id: string) =>
        fetchApi<{ files: SkillFileTreeNode[] }>(`/skills/${encodeURIComponent(id)}/files`),

    readFile: (id: string, filePath: string) =>
        fetchApi<{ path: string; content: string; size: number }>(
            `/skills/${encodeURIComponent(id)}/files?path=${encodeURIComponent(filePath)}`
        ),
}

export interface BuiltinSkillPreset {
    presetId: string
    name: string
    description: string | null
    revision: number
    exportedAt: string
    skillCount: number
    skillCategories: Array<SkillCategory | string>
    entrySkillName: string
    entrySkillCategory: SkillCategory | string
}

export interface SkillPresetListResponse {
    authoringEnabled: boolean
    presets: BuiltinSkillPreset[]
}

export interface SkillPresetPublishResult {
    presetId: string
    revision: number
    preset: SkillPresetAssetV1
}

export const skillPresetApi = {
    list: () => fetchApi<SkillPresetListResponse>('/skills/presets'),

    get: (presetId: string) => fetchApi<{ preset: SkillPresetAssetV1 }>(`/skills/presets/${encodeURIComponent(presetId)}`),

    clone: (presetId: string, data?: { overwriteExisting?: boolean }) =>
        fetchApi<{ presetId: string; skills: Skill[] }>(`/skills/presets/${encodeURIComponent(presetId)}/clone`, {
            method: 'POST',
            body: JSON.stringify({
                ...(data?.overwriteExisting !== undefined ? { overwriteExisting: data.overwriteExisting } : {}),
            }),
        }),

    publish: (data: { skillId: string; name: string; description?: string | null }) =>
        fetchApi<SkillPresetPublishResult>('/skills/presets/publish', {
            method: 'POST',
            body: JSON.stringify({
                skillId: data.skillId,
                name: data.name,
                description: data.description ?? null,
            }),
        }),

    update: (presetId: string, data: { skillId: string; name?: string; description?: string | null }) =>
        fetchApi<SkillPresetPublishResult>(`/skills/presets/${encodeURIComponent(presetId)}`, {
            method: 'PUT',
            body: JSON.stringify({
                skillId: data.skillId,
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
            }),
        }),
}

export const agentApi = {
    list: () =>
        fetchApi<{ agents: Agent[] }>('/agents'),

    get: (id: string) =>
        fetchApi<{ agent: Agent }>(`/agents/${encodeURIComponent(id)}`),

    create: (data: { name: string }) =>
        fetchApi<{ agent: Agent }>('/agents', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    update: (
        id: string,
        data: Partial<{
            name: string
            content: string
            enabled: boolean
        }>
    ) =>
        fetchApi<{ agent: Agent }>(`/agents/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    delete: (id: string) =>
        fetchApi<{ ok: true }>(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

// Upload API
export const uploadApi = {
    image: async (file: File): Promise<{ url: string; filename: string }> => {
        const token = useAuthStore.getState().token
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch(`${API_BASE}/upload/image`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Upload failed' }))
            throw new ApiError(response.status, error.detail, error)
        }

        return response.json()
    },
}

// AI API
export type ProviderType = 'openai-chat' | 'openai-image' | 'gemini'

export interface AiModel {
    id: string
    name: string
}

export interface AiConnection {
    id: string
    name: string
    providerType: ProviderType | string
    baseUrl: string | null
    isActive: boolean
    models: AiModel[]
    lastFetchedAt: string | null
    createdAt: string
    updatedAt: string
}

export type CodexConnectionProviderType = 'openai-official' | 'custom'
export type CodexUpstreamFormat = 'responses' | 'chat-completions'
export interface CodexProviderModel {
    id: string
    displayName: string
    contextWindow: number
    supportedReasoningEfforts: CodexReasoningEffort[]
    defaultReasoningEffort: CodexReasoningEffort
    supportsParallelToolCalls: boolean
    inputModalities: Array<'text' | 'image'>
    chatReasoning?: {
        supportsThinking: boolean
        supportsEffort: boolean
        thinkingParam: 'thinking' | 'enable_thinking' | 'none'
        effortParam: 'reasoning_effort' | 'none'
        outputFormat: 'reasoning_content' | 'think-tags'
    }
}
export type CodexConnectionAuthStatus =
    | 'unauthenticated'
    | 'authorizing'
    | 'authenticated'
    | 'error'

export interface CodexConnectionSummary {
    id: string
    name: string
    providerType: CodexConnectionProviderType | string
    upstreamFormat: CodexUpstreamFormat | null
    baseUrl: string | null
    hasApiKey: boolean
    defaultModelId: string | null
    models: CodexProviderModel[]
    isActive: boolean
    note: string | null
    authStatus: CodexConnectionAuthStatus | string
    authType: string | null
    accountEmail: string | null
    accountPlan: string | null
    lastAuthError: string | null
    createdAt: string
    updatedAt: string
}

export interface CodexConnectionDetail {
    connection: CodexConnectionSummary
    authJson: string
    configToml: string
    rateLimits: CodexRateLimits | null
}

export interface CodexModel {
    id: string
    name: string
}

export interface CodexModelCatalogEntry {
    id: string
    displayName: string
    description: string
    supportedReasoningEfforts: CodexReasoningEffort[]
    defaultReasoningEffort: CodexReasoningEffort
    serviceTiers: Array<{
        id: string
        name: string
        description: string
    }>
}

export interface CodexAuthSessionStatus {
    loginId: string
    type?: 'chatgpt' | 'chatgptDeviceCode'
    authUrl: string | null
    verificationUrl?: string | null
    userCode?: string | null
    status: CodexConnectionAuthStatus | string
    error: string | null
    startedAt: number
    completedAt: number | null
}

export interface CodexRateLimitWindow {
    usedPercent: number
    resetsAt?: number | null
    windowDurationMins?: number | null
}

export interface CodexRateLimits {
    credits?: {
        balance?: string | null
        hasCredits?: boolean
        unlimited?: boolean
    } | null
    limitName?: string | null
    limitId?: string | null
    planType?: string | null
    primary?: CodexRateLimitWindow | null
    secondary?: CodexRateLimitWindow | null
}

export const aiApi = {
    listConnections: () => fetchApi<AiConnection[]>('/ai/connections'),

    createConnection: (data: { name: string; providerType: ProviderType; apiKey: string; baseUrl?: string }) =>
        fetchApi<{ connection: AiConnection }>('/ai/connections', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    deleteConnection: (id: string) =>
        fetchApi<{ message: string }>(`/ai/connections/${id}`, { method: 'DELETE' }),

    refreshModels: (connectionId: string) =>
        fetchApi<{ models: AiModel[] }>('/ai/models', {
            method: 'POST',
            body: JSON.stringify({ connectionId }),
        }),

    testModel: (data: { connectionId: string; modelId: string; prompt?: string }) =>
        fetchApi<{ text: string }>('/ai/test', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    runModel: (
        data: {
            connectionId: string
            modelId: string
            system?: string
            temperature?: number
            maxTokens?: number
            messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
            prompt?: string
        },
        options?: { signal?: AbortSignal }
    ) =>
        fetchApi<{ text: string; reasoningText?: string }>('/ai/run', {
            method: 'POST',
            body: JSON.stringify(data),
            signal: options?.signal,
        }),

    listGroups: () => fetchApi<{ groups: ModelGroup[] }>('/ai/groups'),

    createGroup: (data: { name: string }) =>
        fetchApi<{ group: ModelGroup }>('/ai/groups', { method: 'POST', body: JSON.stringify(data) }),

    updateGroup: (groupId: string, updates: Partial<ModelGroup>) =>
        fetchApi<{ id: string }>(`/ai/groups/${groupId}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }),

    deleteGroup: (groupId: string) =>
        fetchApi<{ message: string }>(`/ai/groups/${groupId}`, { method: 'DELETE' }),

    setGroupAssignments: (groupId: string, assignments: ModelAssignment[]) =>
        fetchApi<{ ok: true }>(`/ai/groups/${groupId}/assignments`, {
            method: 'PUT',
            body: JSON.stringify({ assignments }),
        }),

    patchAssignment: (assignmentId: string, updates: Partial<ModelAssignment>) =>
        fetchApi<{ ok: true }>(`/ai/assignments/${assignmentId}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        }),

    listModelSets: () => fetchApi<{ sets: ModelSet[] }>('/ai/model-sets'),

    createModelSet: (data: { name: string }) =>
        fetchApi<{ set: ModelSet }>('/ai/model-sets', { method: 'POST', body: JSON.stringify(data) }),

    updateModelSet: (setId: string, updates: Partial<ModelSet>) =>
        fetchApi<{ id: string }>(`/ai/model-sets/${setId}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }),

    deleteModelSet: (setId: string) =>
        fetchApi<{ message: string }>(`/ai/model-sets/${setId}`, { method: 'DELETE' }),

    setModelSetMembers: (setId: string, members: Pick<ModelSetMember, 'groupId'>[]) =>
        fetchApi<{ ok: true }>(`/ai/model-sets/${setId}/members`, {
            method: 'PUT',
            body: JSON.stringify({ members }),
        }),
}

export const editorChatApi = {
    list: (novelId: string) =>
        fetchApi<{ conversations: EditorChatConversation[] }>(`/novels/${encodeURIComponent(novelId)}/chats`),

    create: (
        novelId: string,
        data: {
            id?: string
            title?: string | null
            titleManuallyEdited?: boolean
            promptId?: string | null
            selectedGroupId?: string | null
            draftContent?: string
            promptSnapshot?: Prompt | null
            inputState?: unknown
        }
    ) =>
        fetchApi<{ conversation: EditorChatConversation }>(`/novels/${encodeURIComponent(novelId)}/chats`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    update: (
        id: string,
        data: Partial<{
            title: string | null
            titleManuallyEdited: boolean
            promptId: string | null
            selectedGroupId: string | null
            draftContent: string
            promptSnapshot: Prompt | null
            inputState: unknown
        }>
    ) =>
        fetchApi<{ conversation: EditorChatConversation }>(`/chats/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),

    delete: (id: string) =>
        fetchApi<{ ok: true }>(`/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    clone: (id: string, data?: { throughMessageId?: string | null }) =>
        fetchApi<{ conversation: EditorChatConversation }>(`/chats/${encodeURIComponent(id)}/clone`, {
            method: 'POST',
            body: JSON.stringify(data ?? {}),
        }),

    appendMessage: (
        id: string,
        data: {
            role: 'user' | 'assistant'
            content: string
            sentContent?: string | null
            fullRenderedContent?: string | null
            promptTokens?: number | null
            completionTokens?: number | null
            totalTokens?: number | null
            termIds?: string[]
            attachments?: string[]
        }
    ) =>
        fetchApi<{ conversation: EditorChatConversation }>(`/chats/${encodeURIComponent(id)}/messages`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    updateMessage: (
        id: string,
        messageId: string,
        data: {
            content: string
        }
    ) =>
        fetchApi<{ conversation: EditorChatConversation }>(
            `/chats/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,
            {
                method: 'PATCH',
                body: JSON.stringify(data),
            }
        ),

    deleteMessages: (id: string, messageIds: string[]) =>
        fetchApi<{ conversation: EditorChatConversation }>(`/chats/${encodeURIComponent(id)}/messages`, {
            method: 'DELETE',
            body: JSON.stringify({ messageIds }),
        }),
}

export type CodexSessionCategory = 'general' | 'scene_operation' | 'scene_continuation'

export type CodexSessionCleanupResult = {
    deletedSessionIds: string[]
}

/**
 * A chat skill's bound prompt, pre-assembled on the client (filled inputs + the auto-injected
 * overview and referenced terms). The message route materializes these blocks into the session's
 * `artifacts/` so Codex can run_llm against the file or read it for context.
 */
export interface CodexPromptArtifact {
    skillId: string
    renderedBlocks: Array<{ role: string; text: string }>
}
export type CodexSessionStatus = 'idle' | 'running' | 'error'
export type CodexReviewLevel = 'user_review' | 'auto_review' | 'no_review'
export type CodexReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
export type CodexServiceTier = 'standard' | 'fast'

export type CodexSessionMessage = {
    id: string
    role: 'user' | 'assistant' | 'event'
    content: string
    kind?: string | null
    contextWindow?: CodexContextWindow | null
    attachments?: string[]
    jsonArtifacts?: string[]
    createdAt: string
}

export type CodexTokenUsage = {
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    totalTokens: number
}

export type CodexContextWindow = {
    usedTokens: number
    totalTokens: number
    usagePercent: number
    remainingTokens: number
    lastTokenUsage: CodexTokenUsage | null
    totalTokenUsage: CodexTokenUsage | null
}

export type CodexRunEvent = {
    id: string
    kind: string
    title: string
    content: string
    attachments?: string[]
    createdAt: string
}

export type CodexSessionStreamEvent =
    | { type: 'assistant_delta'; delta: string; id?: string; createdAt?: string }
    | { type: 'plan_delta'; id: string; delta: string; createdAt: string }
    | { type: 'event'; event: CodexRunEvent }
    | { type: 'approval_request'; approval: CodexApprovalRequest }
    | { type: 'context_window'; contextWindow: CodexContextWindow }
    | { type: 'done'; session: CodexSession }
    | { type: 'error'; session?: CodexSession; detail: string }

export type CodexApprovalOption = 'accept' | 'acceptForSession' | 'acceptWithPolicy' | 'decline' | 'cancel' | 'steer'

export type CodexApprovalRequest = {
    id: string
    sessionId: string
    threadId: string | null
    turnId: string | null
    kind: 'command' | 'file' | 'permissions' | 'elicitation' | 'tool' | 'unknown'
    title: string
    detail: string
    command: string | null
    cwd: string | null
    server: string | null
    tool: string | null
    proposedPolicy: string[] | null
    options: CodexApprovalOption[]
    createdAt: string
}

export type CodexSession = {
    id: string
    category: CodexSessionCategory
    title: string | null
    titleManuallyEdited: boolean
    reviewLevel: CodexReviewLevel
    modelId: string
    reasoningEffort: CodexReasoningEffort
    serviceTier: CodexServiceTier
    planMode: boolean
    codexThreadId: string | null
    codexConnectionId: string | null
    draftContent: string
    draftAttachments: string[]
    draftArtifacts: CodexDraftArtifact[]
    status: CodexSessionStatus
    lastError: string | null
    unreadCompletionAt: string | null
    novelId: string
    ownerId: string
    createdAt: string
    updatedAt: string
    messages: CodexSessionMessage[]
}

export type CodexDraftArtifact = {
    fileName: string
    originalName: string
    size: number
}

async function readSseStream(
    response: Response,
    onEvent: (event: CodexSessionStreamEvent) => void
) {
    if (!response.body) throw new ApiError(response.status, 'Streaming response is not readable')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = 'message'
    let dataLines: string[] = []

    const dispatch = () => {
        if (dataLines.length === 0) return
        const data = JSON.parse(dataLines.join('\n')) as unknown
        if (eventName === 'assistant_delta' && data && typeof data === 'object') {
            const record = data as Record<string, unknown>
            if (typeof record.delta === 'string') {
                onEvent({
                    type: 'assistant_delta',
                    delta: record.delta,
                    id: typeof record.id === 'string' ? record.id : undefined,
                    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
                })
            }
        } else if (eventName === 'plan_delta' && data && typeof data === 'object') {
            const record = data as Record<string, unknown>
            if (
                typeof record.id === 'string' &&
                typeof record.delta === 'string' &&
                typeof record.createdAt === 'string'
            ) {
                onEvent({ type: 'plan_delta', id: record.id, delta: record.delta, createdAt: record.createdAt })
            }
        } else if (eventName === 'event' && data && typeof data === 'object') {
            onEvent({ type: 'event', event: data as CodexRunEvent })
        } else if (eventName === 'approval_request' && data && typeof data === 'object') {
            const record = data as Record<string, unknown>
            onEvent({ type: 'approval_request', approval: record.approval as CodexApprovalRequest })
        } else if (eventName === 'context_window' && data && typeof data === 'object') {
            const record = data as Record<string, unknown>
            onEvent({ type: 'context_window', contextWindow: record.contextWindow as CodexContextWindow })
        } else if (eventName === 'done' && data && typeof data === 'object') {
            const record = data as Record<string, unknown>
            onEvent({ type: 'done', session: record.session as CodexSession })
        } else if (eventName === 'error' && data && typeof data === 'object') {
            const record = data as Record<string, unknown>
            onEvent({
                type: 'error',
                session: record.session as CodexSession | undefined,
                detail: typeof record.detail === 'string' ? record.detail : 'Codex run failed.',
            })
        }
        eventName = 'message'
        dataLines = []
    }

    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex >= 0) {
            const rawLine = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
            if (!line) {
                dispatch()
            } else if (line.startsWith('event:')) {
                eventName = line.slice('event:'.length).trim()
            } else if (line.startsWith('data:')) {
                dataLines.push(line.slice('data:'.length).trimStart())
            }
            newlineIndex = buffer.indexOf('\n')
        }
    }
    dispatch()
}

export const codexSessionApi = {
    list: (novelId: string) =>
        fetchApi<{ sessions: CodexSession[] }>(`/novels/${encodeURIComponent(novelId)}/codex/sessions`),

    create: (
        novelId: string,
        data?: {
            id?: string
            category?: CodexSessionCategory
            title?: string | null
            titleManuallyEdited?: boolean
            reviewLevel?: CodexReviewLevel
            modelId?: string
            reasoningEffort?: CodexReasoningEffort
            serviceTier?: CodexServiceTier
            planMode?: boolean
            draftContent?: string
            draftAttachments?: string[]
            draftArtifacts?: CodexDraftArtifact[]
            /** For `scene_operation` sessions: the skill + scene to pre-assemble a prompt artifact for. */
            skillId?: string
            sceneId?: string
            /** For `scene_continuation` sessions: the inline panel + its already-resolved prompt. */
            chapterId?: string
            panelId?: string
            renderedBlocks?: Array<{ role: string; text: string }>
        }
    ) =>
        fetchApi<{ session: CodexSession; codexSessionCleanup: CodexSessionCleanupResult }>(`/novels/${encodeURIComponent(novelId)}/codex/sessions`, {
            method: 'POST',
            body: JSON.stringify(data ?? {}),
        }),

    update: (
        id: string,
        data: Partial<{
            title: string | null
            titleManuallyEdited: boolean
            reviewLevel: CodexReviewLevel
            modelId: string
            reasoningEffort: CodexReasoningEffort
            serviceTier: CodexServiceTier
            planMode: boolean
            draftContent: string
            draftAttachments: string[]
            draftArtifacts: CodexDraftArtifact[]
        }>
    ) =>
        fetchApi<{ session: CodexSession }>(`/codex/sessions/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),

    delete: (id: string) =>
        fetchApi<{ ok: true; removedPanelId: string | null }>(`/codex/sessions/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        }),

    markCompletionRead: (id: string, completedAt: string) =>
        fetchApi<{ ok: true }>(`/codex/sessions/${encodeURIComponent(id)}/read-completion`, {
            method: 'POST',
            body: JSON.stringify({ completedAt }),
        }),

    uploadJsonArtifact: async (id: string, file: File) => {
        const token = useAuthStore.getState().token
        if (!token) throw new ApiError(401, 'Not authenticated - no token available')
        const form = new FormData()
        form.set('file', file)
        const response = await fetch(`${API_BASE}/codex/sessions/${encodeURIComponent(id)}/artifacts`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
        })
        if (!response.ok) {
            if (response.status === 401) useAuthStore.getState().logout()
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
            throw new ApiError(response.status, error.detail || 'Artifact upload failed', error)
        }
        return response.json() as Promise<{
            artifact: { fileName: string; originalName: string; size: number }
        }>
    },

    resolveApproval: (
        sessionId: string,
        approvalId: string,
        data: { decision: CodexApprovalOption; message?: string }
    ) =>
        fetchApi<{ ok: true }>(
            `/codex/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
            {
                method: 'POST',
                body: JSON.stringify(data),
            }
        ),

    steerMessage: (id: string, content: string, attachments?: string[]) =>
        fetchApi<{ ok: true }>(`/codex/sessions/${encodeURIComponent(id)}/steer`, {
            method: 'POST',
            body: JSON.stringify({ content, attachments }),
        }),

    stop: (id: string) =>
        fetchApi<{ ok: true }>(`/codex/sessions/${encodeURIComponent(id)}/stop`, {
            method: 'POST',
        }),

    sendMessage: (
        id: string,
        content: string,
        options?: { signal?: AbortSignal; skillIds?: string[]; promptArtifact?: CodexPromptArtifact; attachments?: string[]; artifactFiles?: string[] }
    ) =>
        fetchApi<{ session: CodexSession }>(`/codex/sessions/${encodeURIComponent(id)}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content,
                skillIds: options?.skillIds,
                promptArtifact: options?.promptArtifact,
                attachments: options?.attachments,
                artifactFiles: options?.artifactFiles,
            }),
            signal: options?.signal,
        }),

    streamMessage: async (
        id: string,
        content: string,
        options: {
            signal?: AbortSignal
            skillIds?: string[]
            promptArtifact?: CodexPromptArtifact
            attachments?: string[]
            artifactFiles?: string[]
            onEvent: (event: CodexSessionStreamEvent) => void
        }
    ) => {
        const token = useAuthStore.getState().token
        if (!token) throw new ApiError(401, 'Not authenticated - no token available')

        const response = await fetch(`${API_BASE}/codex/sessions/${encodeURIComponent(id)}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                content,
                stream: true,
                skillIds: options.skillIds,
                promptArtifact: options.promptArtifact,
                attachments: options.attachments,
                artifactFiles: options.artifactFiles,
            }),
            signal: options.signal,
        })

        if (!response.ok) {
            if (response.status === 401) {
                useAuthStore.getState().logout()
            }
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
            throw new ApiError(response.status, error.detail || 'Request failed', error)
        }

        await readSseStream(response, options.onEvent)
    },

    streamCompaction: async (
        id: string,
        options: {
            signal?: AbortSignal
            onEvent: (event: CodexSessionStreamEvent) => void
        }
    ) => {
        const token = useAuthStore.getState().token
        if (!token) throw new ApiError(401, 'Not authenticated - no token available')

        const response = await fetch(`${API_BASE}/codex/sessions/${encodeURIComponent(id)}/compact`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ stream: true }),
            signal: options.signal,
        })

        if (!response.ok) {
            if (response.status === 401) {
                useAuthStore.getState().logout()
            }
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
            throw new ApiError(response.status, error.detail || 'Request failed', error)
        }

        await readSseStream(response, options.onEvent)
    },
}

export type ContinuationDraft = {
    panelId: string
    novelId: string
    sceneId: string
    chapterId: string
    codexSessionId: string | null
    skillId: string | null
    content: string
    planning: string
    updatedBy: string
    updatedAt: string
}

export const continuationDraftApi = {
    get: (panelId: string) =>
        fetchApi<{ draft: ContinuationDraft | null }>(`/continuation-drafts/${encodeURIComponent(panelId)}`),

    save: (
        panelId: string,
        data: {
            novelId: string
            sceneId: string
            chapterId: string
            content: string
            planning?: string
            updatedBy?: 'user' | 'model' | 'codex'
            codexSessionId?: string | null
            skillId?: string | null
        }
    ) =>
        fetchApi<{ draft: ContinuationDraft }>(`/continuation-drafts/${encodeURIComponent(panelId)}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    delete: (panelId: string) =>
        fetchApi<{ ok: true }>(`/continuation-drafts/${encodeURIComponent(panelId)}`, { method: 'DELETE' }),
}

export const codexApi = {
    listConnections: () => fetchApi<CodexConnectionSummary[]>('/codex/connections'),

    getConnection: (id: string) =>
        fetchApi<CodexConnectionDetail>(`/codex/connections/${id}`),

    listConnectionModels: (id: string) =>
        fetchApi<{ models: CodexModelCatalogEntry[] }>(`/codex/connections/${id}/models`),

    createConnection: (data: {
        name: string
        providerType: CodexConnectionProviderType
        isActive?: boolean
        note?: string | null
        authJson?: string
        configToml?: string
        upstreamFormat?: CodexUpstreamFormat
        baseUrl?: string
        apiKey?: string
        defaultModelId?: string
        models?: CodexProviderModel[]
    }) =>
        fetchApi<CodexConnectionDetail>('/codex/connections', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    updateConnection: (
        id: string,
        data: {
            name: string
            providerType: CodexConnectionProviderType
            isActive?: boolean
            note?: string | null
            authJson?: string
            configToml?: string
            upstreamFormat?: CodexUpstreamFormat
            baseUrl?: string
            apiKey?: string
            defaultModelId?: string
            models?: CodexProviderModel[]
        }
    ) =>
        fetchApi<CodexConnectionDetail>(`/codex/connections/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    deleteConnection: (id: string) =>
        fetchApi<{ message: string }>(`/codex/connections/${id}`, {
            method: 'DELETE',
        }),

    startOfficialAuth: (id: string, type: 'chatgpt' | 'chatgptDeviceCode' = 'chatgpt') =>
        fetchApi<
            | { type: 'chatgpt'; loginId: string; authUrl: string; verificationUrl: null; userCode: null }
            | {
                type: 'chatgptDeviceCode'
                loginId: string
                authUrl: null
                verificationUrl: string
                userCode: string
            }
        >(`/codex/connections/${id}/auth/start`, {
            method: 'POST',
            body: JSON.stringify({ type }),
        }),

    getOfficialAuthStatus: (id: string) =>
        fetchApi<{
            connection: CodexConnectionSummary
            session: CodexAuthSessionStatus | null
            rateLimits: CodexRateLimits | null
        }>(
            `/codex/connections/${id}/auth/status`
        ),

    fetchCustomModels: (data: { apiKey?: string; baseUrl?: string; connectionId?: string }) =>
        fetchApi<{ models: CodexModel[] }>('/codex/models', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
}
