import { aiApi, promptApi, promptDefaultsApi, type DefaultPromptSelectionCategory, type Prompt, type PromptDefaultSelection } from '@/lib/api'
import type { ModelGroup } from '@/lib/ai-store'
import { getLlmBindableModelGroups } from '@/lib/model-bindings'
import { PROMPTS_CHANGED_EVENT } from '@/lib/prompt-events'
import { MODEL_GROUPS_CHANGED_EVENT } from '@/lib/model-group-events'

type DefaultsState = Partial<Record<DefaultPromptSelectionCategory, PromptDefaultSelection>>

export type SceneContinuationMenuData = {
    prompts: Prompt[]
    defaults: DefaultsState
    groups: ModelGroup[]
}

let cachedSceneContinuationMenuData: SceneContinuationMenuData | null = null
let sceneContinuationMenuDataPromise: Promise<SceneContinuationMenuData> | null = null

export function invalidateSceneContinuationMenuDataCache() {
    cachedSceneContinuationMenuData = null
    sceneContinuationMenuDataPromise = null
}

// 提示词绑定或模型分组成员变化时，立即作废缓存——这样即使消费面板当前未挂载，
// 下次挂载也会拉到最新数据，无需整页刷新。
if (typeof window !== 'undefined') {
    window.addEventListener(PROMPTS_CHANGED_EVENT, invalidateSceneContinuationMenuDataCache)
    window.addEventListener(MODEL_GROUPS_CHANGED_EVENT, invalidateSceneContinuationMenuDataCache)
}

export async function loadSceneContinuationMenuData(): Promise<SceneContinuationMenuData> {
    if (cachedSceneContinuationMenuData) return cachedSceneContinuationMenuData
    if (sceneContinuationMenuDataPromise) return sceneContinuationMenuDataPromise

    sceneContinuationMenuDataPromise = Promise.all([
        promptApi.list({ category: 'scene_continuation' }),
        promptDefaultsApi.get(),
        aiApi.listGroups(),
    ])
        .then(([promptResult, defaultsResult, groupsResult]) => ({
            prompts: (promptResult.prompts ?? []).filter((prompt) => prompt.allowLlmCall === true),
            defaults: defaultsResult.defaults ?? {},
            groups: getLlmBindableModelGroups(groupsResult.groups ?? []),
        }))
        .then((data) => {
            cachedSceneContinuationMenuData = data
            sceneContinuationMenuDataPromise = null
            return data
        })
        .catch((error) => {
            sceneContinuationMenuDataPromise = null
            throw error
        })

    return sceneContinuationMenuDataPromise
}
