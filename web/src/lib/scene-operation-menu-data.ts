import { aiApi, promptApi, promptDefaultsApi, type DefaultPromptSelectionCategory, type Prompt, type PromptDefaultSelection } from '@/lib/api'
import type { ModelGroup } from '@/lib/ai-store'
import { getLlmBindableModelGroups } from '@/lib/model-bindings'
import { PROMPTS_CHANGED_EVENT } from '@/lib/prompt-events'
import { MODEL_GROUPS_CHANGED_EVENT } from '@/lib/model-group-events'

type DefaultsState = Partial<Record<DefaultPromptSelectionCategory, PromptDefaultSelection>>

export type SceneOperationMenuData = {
    prompts: Prompt[]
    defaults: DefaultsState
    groups: ModelGroup[]
}

let cachedSceneOperationMenuData: SceneOperationMenuData | null = null
let sceneOperationMenuDataPromise: Promise<SceneOperationMenuData> | null = null

export function invalidateSceneOperationMenuDataCache() {
    cachedSceneOperationMenuData = null
    sceneOperationMenuDataPromise = null
}

// 提示词绑定或模型分组成员变化时，立即作废缓存——这样即使消费面板当前未挂载，
// 下次挂载也会拉到最新数据，无需整页刷新。
if (typeof window !== 'undefined') {
    window.addEventListener(PROMPTS_CHANGED_EVENT, invalidateSceneOperationMenuDataCache)
    window.addEventListener(MODEL_GROUPS_CHANGED_EVENT, invalidateSceneOperationMenuDataCache)
}

export async function loadSceneOperationMenuData(): Promise<SceneOperationMenuData> {
    if (cachedSceneOperationMenuData) return cachedSceneOperationMenuData
    if (sceneOperationMenuDataPromise) return sceneOperationMenuDataPromise

    sceneOperationMenuDataPromise = Promise.all([
        promptApi.list({ category: 'scene_action' }),
        promptDefaultsApi.get(),
        aiApi.listGroups(),
    ])
        .then(([promptResult, defaultsResult, groupsResult]) => ({
            prompts: (promptResult.prompts ?? []).filter((prompt) => prompt.allowLlmCall === true),
            defaults: defaultsResult.defaults ?? {},
            groups: getLlmBindableModelGroups(groupsResult.groups ?? []),
        }))
        .then((data) => {
            cachedSceneOperationMenuData = data
            sceneOperationMenuDataPromise = null
            return data
        })
        .catch((error) => {
            sceneOperationMenuDataPromise = null
            throw error
        })

    return sceneOperationMenuDataPromise
}
