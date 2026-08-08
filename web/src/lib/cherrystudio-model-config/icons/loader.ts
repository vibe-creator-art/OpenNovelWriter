import type { IconRef } from './registry'
import type { ThemedIcon } from './types'

type ModelCatalog = typeof import('./models/catalog')
type ProviderCatalog = typeof import('./providers/catalog')
let modelCatalog: ModelCatalog | undefined
let providerCatalog: ProviderCatalog | undefined
let modelCatalogPromise: Promise<ModelCatalog> | undefined
let providerCatalogPromise: Promise<ProviderCatalog> | undefined

export function getLoadedIcon(ref: IconRef): ThemedIcon | undefined {
  return ref.kind === 'model'
    ? modelCatalog?.MODEL_ICON_CATALOG[ref.key]
    : providerCatalog?.PROVIDER_ICON_CATALOG[ref.key]
}

export async function loadIcon(ref: IconRef): Promise<ThemedIcon | undefined> {
  if (ref.kind === 'model') {
    modelCatalogPromise ??= import('./models/catalog').then((catalog) => {
      modelCatalog = catalog
      return catalog
    })
    return (await modelCatalogPromise).MODEL_ICON_CATALOG[ref.key]
  }

  providerCatalogPromise ??= import('./providers/catalog').then((catalog) => {
    providerCatalog = catalog
    return catalog
  })
  return (await providerCatalogPromise).PROVIDER_ICON_CATALOG[ref.key]
}
