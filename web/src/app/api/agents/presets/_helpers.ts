import type { BuiltinAgentPresetRegistryEntry } from '@/agent-presets'
import type { BuiltinAgentPreset } from '@/lib/api'

export function toBuiltinAgentPresetPayload(entry: BuiltinAgentPresetRegistryEntry): BuiltinAgentPreset {
    return {
        presetId: entry.summary.presetId,
        name: entry.summary.name,
        description: entry.summary.description,
        revision: entry.summary.revision,
        exportedAt: entry.summary.exportedAt,
    }
}
