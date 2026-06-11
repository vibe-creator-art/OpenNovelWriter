// Hand-written shim standing in for CherryStudio's renderer-era (v1)
// `@renderer/types` Model — the input shape consumed by the synced bridge.

export type Model = {
    id: string
    name: string
    provider: string
    group?: string
}
