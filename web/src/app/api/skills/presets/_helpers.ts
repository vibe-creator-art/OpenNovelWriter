import type { BuiltinSkillPresetRegistryEntry } from '@/skill-presets'
import type { BuiltinSkillPreset } from '@/lib/api'

export function toBuiltinSkillPresetPayload(entry: BuiltinSkillPresetRegistryEntry): BuiltinSkillPreset {
    return {
        presetId: entry.summary.presetId,
        name: entry.summary.name,
        description: entry.summary.description,
        revision: entry.summary.revision,
        exportedAt: entry.summary.exportedAt,
        skillCount: entry.summary.skillCount,
        skillCategories: entry.summary.skillCategories,
        entrySkillName: entry.summary.entrySkillName,
        entrySkillCategory: entry.summary.entrySkillCategory,
    }
}
