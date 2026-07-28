export type ProviderModel = {
    id: string
    name: string
}

export function parseOpenAiModelList(value: unknown): ProviderModel[] {
    if (!Array.isArray(value)) return []

    return value.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const rawId = (item as Record<string, unknown>).id
        const id = typeof rawId === 'string' ? rawId.trim() : ''
        return id ? [{ id, name: id }] : []
    })
}

export function requireProviderModels<T extends ProviderModel>(models: T[]): T[] {
    if (models.length === 0) {
        throw new Error('No models are available for this API key.')
    }
    return models
}
