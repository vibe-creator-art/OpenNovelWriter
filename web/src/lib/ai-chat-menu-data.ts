import { aiApi, promptApi, promptDefaultsApi, type DefaultPromptSelectionCategory, type Prompt, type PromptDefaultSelection } from '@/lib/api'
import type { ModelGroup } from '@/lib/ai-store'
import { getLlmBindableModelGroups } from '@/lib/model-bindings'

type DefaultsState = Partial<Record<DefaultPromptSelectionCategory, PromptDefaultSelection>>

export type AiChatMenuData = {
    prompts: Prompt[]
    defaults: DefaultsState
    groups: ModelGroup[]
}

let cachedAiChatMenuData: AiChatMenuData | null = null
let aiChatMenuDataPromise: Promise<AiChatMenuData> | null = null

export function invalidateAiChatMenuDataCache() {
    cachedAiChatMenuData = null
    aiChatMenuDataPromise = null
}

export async function loadAiChatMenuData(): Promise<AiChatMenuData> {
    if (cachedAiChatMenuData) return cachedAiChatMenuData
    if (aiChatMenuDataPromise) return aiChatMenuDataPromise

    aiChatMenuDataPromise = Promise.all([
        promptApi.list({ category: 'ai_chat' }),
        promptDefaultsApi.get(),
        aiApi.listGroups(),
    ])
        .then(([promptResult, defaultsResult, groupsResult]) => ({
            prompts: (promptResult.prompts ?? []).filter((prompt) => prompt.allowLlmCall === true),
            defaults: defaultsResult.defaults ?? {},
            groups: getLlmBindableModelGroups(groupsResult.groups ?? []),
        }))
        .then((data) => {
            cachedAiChatMenuData = data
            aiChatMenuDataPromise = null
            return data
        })
        .catch((error) => {
            aiChatMenuDataPromise = null
            throw error
        })

    return aiChatMenuDataPromise
}
