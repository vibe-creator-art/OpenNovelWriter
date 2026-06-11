import type { BuiltinPromptPresetRegistryEntry } from '@/presets'
import type { BuiltinPromptPreset } from '@/lib/api'

export function toBuiltinPresetPayload(entry: BuiltinPromptPresetRegistryEntry): BuiltinPromptPreset {
    return {
        presetId: entry.summary.presetId,
        name: entry.summary.name,
        description: entry.summary.description,
        revision: entry.summary.revision,
        exportedAt: entry.summary.exportedAt,
        promptCount: entry.summary.promptCount,
        promptCategories: entry.summary.promptCategories,
        entryPromptName: entry.summary.entryPromptName,
        entryPromptCategory: entry.summary.entryPromptCategory,
    }
}
