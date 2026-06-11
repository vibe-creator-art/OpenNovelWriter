function isTruthyEnvValue(value: string | undefined) {
    return value === 'true' || value === '1'
}

export const presetAuthoringEnabled = isTruthyEnvValue(process.env.NEXT_PUBLIC_PRESET_AUTHORING)

export function isPresetAuthoringEnabled() {
    return presetAuthoringEnabled || isTruthyEnvValue(process.env.PRESET_AUTHORING)
}
