import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT_DIR = process.cwd()
const DEFAULT_REPO_DIR = path.resolve(ROOT_DIR, '..', '..', 'cherry-studio')
const CONFIG_DIR = path.resolve(ROOT_DIR, 'src', 'lib', 'cherrystudio-model-config')
const TARGET_MODELS_DIR = path.join(CONFIG_DIR, 'models')
const TARGET_ICONS_DIR = path.join(CONFIG_DIR, 'icons')
const repoDir = process.argv[2] ? path.resolve(ROOT_DIR, process.argv[2]) : DEFAULT_REPO_DIR

const SYNCED_MODEL_FILES = [
  ['packages/provider-registry/src/utils/normalize.ts', 'normalize.ts'],
  ['packages/provider-registry/src/patterns/reasoning-families.gen.ts', 'reasoning-families.gen.ts'],
  ['packages/provider-registry/src/patterns/reasoning-membership.ts', 'reasoning-membership.ts'],
]

const MODELS_DATA_FILE = 'packages/provider-registry/data/models.json'
const PROVIDER_MODELS_DATA_FILE = 'packages/provider-registry/data/provider-models.json'
const PROVIDERS_DATA_FILE = 'packages/provider-registry/data/providers.json'
const ICONS_SOURCE_DIR = 'packages/ui/src/components/icons'
const ICON_REGISTRY_FILE = `${ICONS_SOURCE_DIR}/registry.ts`

const requiredSources = [
  ...SYNCED_MODEL_FILES.map(([source]) => source),
  MODELS_DATA_FILE,
  PROVIDER_MODELS_DATA_FILE,
  PROVIDERS_DATA_FILE,
  ICON_REGISTRY_FILE,
]

for (const source of requiredSources) {
  const sourcePath = path.join(repoDir, source)
  if (!fs.existsSync(sourcePath)) {
    console.error(`Missing CherryStudio source file: ${sourcePath}`)
    process.exit(1)
  }
}

const iconPlan = buildIconPlan()

fs.rmSync(TARGET_MODELS_DIR, { recursive: true, force: true })
fs.rmSync(TARGET_ICONS_DIR, { recursive: true, force: true })
fs.mkdirSync(TARGET_MODELS_DIR, { recursive: true })
fs.mkdirSync(TARGET_ICONS_DIR, { recursive: true })

for (const [source, target] of SYNCED_MODEL_FILES) {
  const sourcePath = path.join(repoDir, source)
  const transformed = transformModelSource(source, fs.readFileSync(sourcePath, 'utf8'))
  fs.writeFileSync(
    path.join(TARGET_MODELS_DIR, target),
    [
      '// This file is synced from CherryStudio. Run `npm run sync:cherrystudio-model-config` to update it.',
      `// Source: cherry-studio/${source}`,
      '',
      transformed,
    ].join('\n'),
    'utf8'
  )
}

generateRegistryCapabilities()
generateProviderBaseUrls()
syncIcons(iconPlan)

console.log(`Synced CherryStudio model metadata and icons from ${repoDir}`)

function transformModelSource(sourcePath, source) {
  if (sourcePath.endsWith('reasoning-families.gen.ts')) {
    return source.replace(
      "import type { ReasoningFamilyRule } from '../schemas/model'",
      [
        'export type ReasoningFamilyRule = {',
        '  pattern: string',
        '  template?: boolean',
        "  effort?: readonly string[]",
        '  toggle?: boolean',
        '  budget?: { min: number; max: number }',
        '  wireDialect?: string',
        '}',
      ].join('\n')
    )
  }

  if (sourcePath.endsWith('reasoning-membership.ts')) {
    return source.replace(
      "import type { ReasoningFamilyRule } from '../schemas/model'",
      "import type { ReasoningFamilyRule } from './reasoning-families.gen'"
    )
  }

  return source
}

function generateRegistryCapabilities() {
  const modelRegistry = readJson(MODELS_DATA_FILE)
  const providerModelRegistry = readJson(PROVIDER_MODELS_DATA_FILE)
  const modelById = new Map()

  for (const model of modelRegistry.models) {
    modelById.set(model.id, model)
  }

  const flagsById = new Map()
  for (const model of modelRegistry.models) {
    flagsById.set(model.id, getFlags(model))
  }

  const providerFlagsById = new Map()
  for (const override of providerModelRegistry.overrides) {
    const preset = modelById.get(override.modelId)
    const capabilities = applyCapabilityOverride(preset?.capabilities ?? [], override.capabilities)
    const inputModalities = override.inputModalities?.length
      ? override.inputModalities
      : preset?.inputModalities
    const hasReasoningContract = Object.values(override.reasoningContracts ?? {}).some(
      (contract) => contract?.support
    )
    const flags = getFlags({
      capabilities,
      inputModalities,
      reasoning: preset?.reasoning ?? (hasReasoningContract ? {} : undefined),
    })
    const canonicalKey = `${override.providerId}::${override.modelId}`

    if (!providerFlagsById.has(canonicalKey) || override.apiModelId === override.modelId) {
      providerFlagsById.set(canonicalKey, flags)
    }
    if (override.apiModelId) {
      providerFlagsById.set(`${override.providerId}::${override.apiModelId}`, flags)
    }
  }

  const modelLines = [...flagsById]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, flags]) => `  ${JSON.stringify(id)}: ${flags},`)
  const providerLines = [...providerFlagsById]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, flags]) => `  ${JSON.stringify(id)}: ${flags},`)

  fs.writeFileSync(
    path.join(TARGET_MODELS_DIR, 'registry-capabilities.ts'),
    [
      '// Generated from CherryStudio provider-registry data.',
      `// Models: ${modelRegistry.version}; provider models: ${providerModelRegistry.version}.`,
      '',
      'export const REGISTRY_FLAG = {',
      '  vision: 1,',
      '  reasoning: 2,',
      '  tool: 4,',
      '  reranker: 8,',
      '  embedding: 16,',
      '  imageGeneration: 32,',
      '} as const',
      '',
      'export const REGISTRY_MODEL_FLAGS: Record<string, number> = {',
      ...modelLines,
      '}',
      '',
      'export const REGISTRY_PROVIDER_MODEL_FLAGS: Record<string, number> = {',
      ...providerLines,
      '}',
      '',
    ].join('\n'),
    'utf8'
  )
}

function getFlags(model) {
  const capabilities = new Set(model.capabilities ?? [])
  const inputModalities = new Set(model.inputModalities ?? [])
  let flags = 0

  if (capabilities.has('image-recognition') || inputModalities.has('image')) flags |= 1
  if (capabilities.has('reasoning') || model.reasoning != null) flags |= 2
  if (capabilities.has('function-call')) flags |= 4
  if (capabilities.has('rerank')) flags |= 8
  else if (capabilities.has('embedding')) flags |= 16
  if (capabilities.has('image-generation')) flags |= 32

  return flags
}

function applyCapabilityOverride(base, override) {
  if (!override) return [...base]
  if (override.force?.length) return [...override.force]

  const capabilities = new Set(base)
  for (const capability of override.add ?? []) capabilities.add(capability)
  for (const capability of override.remove ?? []) capabilities.delete(capability)
  return [...capabilities]
}

function generateProviderBaseUrls() {
  const registry = readJson(PROVIDERS_DATA_FILE)
  const providerByBaseUrl = new Map()

  for (const provider of registry.providers) {
    for (const endpoint of Object.values(provider.endpointConfigs ?? {})) {
      const baseUrl = normalizeBaseUrl(endpoint?.baseUrl)
      if (baseUrl && !providerByBaseUrl.has(baseUrl)) {
        providerByBaseUrl.set(baseUrl, provider.id)
      }
    }
  }

  const entries = [...providerByBaseUrl]
    .sort(([left], [right]) => right.length - left.length)
    .map(([baseUrl, providerId]) => `  [${JSON.stringify(baseUrl)}, ${JSON.stringify(providerId)}],`)

  fs.writeFileSync(
    path.join(TARGET_MODELS_DIR, 'provider-base-urls.ts'),
    [
      '// Generated from CherryStudio provider-registry data.',
      `// Providers: ${registry.version}.`,
      '',
      'export const REGISTRY_PROVIDER_BASE_URLS: ReadonlyArray<readonly [string, string]> = [',
      ...entries,
      ']',
      '',
    ].join('\n'),
    'utf8'
  )
}

function buildIconPlan() {
  const registrySource = fs.readFileSync(path.join(repoDir, ICON_REGISTRY_FILE), 'utf8')
  const modelPatterns = extractConstSection(registrySource, 'MODEL_ICON_PATTERNS', 'const MODEL_TO_PROVIDER_PATTERNS')
  const providerPatterns = extractConstSection(
    registrySource,
    'MODEL_TO_PROVIDER_PATTERNS',
    'const PROVIDER_ID_ALIASES'
  )
  const aliases = trimConstObject(
    extractConstSection(registrySource, 'PROVIDER_ID_ALIASES', 'export type IconRef')
  )
  const aliasMap = parseAliases(aliases)
  const modelKeys = new Set(parsePatternKeys(modelPatterns))
  const providerKeys = new Set(parsePatternKeys(providerPatterns))

  for (const key of aliasMap.values()) providerKeys.add(key)

  const providers = readJson(PROVIDERS_DATA_FILE).providers
  for (const provider of providers) {
    providerKeys.add(aliasMap.get(provider.id) ?? provider.id)
  }

  const availableModelKeys = readIconDirectoryKeys('models')
  const availableProviderKeys = readIconDirectoryKeys('providers')
  const selectedProviderKeys = new Set([...providerKeys].filter((key) => availableProviderKeys.has(key)))

  for (const key of providerKeys) {
    if (!availableProviderKeys.has(key) && availableModelKeys.has(key)) modelKeys.add(key)
  }

  const selectedModelKeys = new Set([...modelKeys].filter((key) => availableModelKeys.has(key)))
  preflightIcons('models', selectedModelKeys)
  preflightIcons('providers', selectedProviderKeys)

  return {
    registrySource,
    modelPatterns,
    providerPatterns,
    aliases,
    modelKeys: [...selectedModelKeys].sort(),
    providerKeys: [...selectedProviderKeys].sort(),
  }
}

function syncIcons(plan) {
  fs.writeFileSync(
    path.join(TARGET_ICONS_DIR, 'types.ts'),
    [
      "import type { SVGProps } from 'react'",
      '',
      'export type IconComponent = (props: SVGProps<SVGSVGElement>) => React.JSX.Element',
      'export type ThemedIcon = { light: IconComponent; dark?: IconComponent }',
      '',
    ].join('\n'),
    'utf8'
  )

  copyIconFiles('models', plan.modelKeys)
  copyIconFiles('providers', plan.providerKeys)

  const generalSource = path.join(repoDir, ICONS_SOURCE_DIR, 'general', 'open-code.tsx')
  if (fs.existsSync(generalSource)) {
    const target = path.join(TARGET_ICONS_DIR, 'general', 'open-code.tsx')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(generalSource, target)
  }

  generateIconCatalog('models', plan.modelKeys)
  generateIconCatalog('providers', plan.providerKeys)
  generateIconRegistry(plan)
  generateIconLoader()
}

function copyIconFiles(kind, keys) {
  for (const key of keys) {
    const targetDir = path.join(TARGET_ICONS_DIR, kind, key)
    fs.mkdirSync(targetDir, { recursive: true })
    for (const variant of ['light.tsx', 'dark.tsx']) {
      const source = path.join(repoDir, ICONS_SOURCE_DIR, kind, key, variant)
      if (!fs.existsSync(source)) continue

      let content = fs.readFileSync(source, 'utf8')
      if (!content.includes('export default')) {
        const namedExport = content.match(/export \{ (\w+) \}/)?.[1]
        if (!namedExport) throw new Error(`Icon has no importable component: ${source}`)
        content += `\nexport default ${namedExport}\n`
      }
      fs.writeFileSync(path.join(targetDir, variant), content, 'utf8')
    }
  }
}

function generateIconCatalog(kind, keys) {
  const imports = []
  const entries = []

  keys.forEach((key, index) => {
    const lightName = `LightIcon${index}`
    const darkName = `DarkIcon${index}`
    const darkSource = path.join(repoDir, ICONS_SOURCE_DIR, kind, key, 'dark.tsx')
    imports.push(`import ${lightName} from './${key}/light'`)
    if (fs.existsSync(darkSource)) imports.push(`import ${darkName} from './${key}/dark'`)
    entries.push(
      `  ${JSON.stringify(key)}: { light: ${lightName}${fs.existsSync(darkSource) ? `, dark: ${darkName}` : ''} },`
    )
  })

  fs.writeFileSync(
    path.join(TARGET_ICONS_DIR, kind, 'catalog.ts'),
    [
      '// Generated from CherryStudio UI icons.',
      "import type { ThemedIcon } from '../types'",
      ...imports,
      '',
      `export const ${kind === 'models' ? 'MODEL' : 'PROVIDER'}_ICON_CATALOG: Record<string, ThemedIcon> = {`,
      ...entries,
      '}',
      '',
    ].join('\n'),
    'utf8'
  )
}

function generateIconRegistry(plan) {
  const modelKeyLines = plan.modelKeys.map((key) => `  ${JSON.stringify(key)},`)
  const providerKeyLines = plan.providerKeys.map((key) => `  ${JSON.stringify(key)},`)
  const registry = [
    '// Synced from CherryStudio UI icon routing.',
    '',
    plan.modelPatterns.trim(),
    '',
    plan.providerPatterns.trim(),
    '',
    plan.aliases.trim(),
    '',
    `const MODEL_ICON_KEYS = new Set<string>([\n${modelKeyLines.join('\n')}\n])`,
    `const PROVIDER_ICON_KEYS = new Set<string>([\n${providerKeyLines.join('\n')}\n])`,
    '',
    "export type IconRef = { kind: 'provider' | 'model'; key: string }",
    '',
    'function providerRef(key: string): IconRef | undefined {',
    "  return PROVIDER_ICON_KEYS.has(key) ? { kind: 'provider', key } : undefined",
    '}',
    '',
    'function modelRef(key: string): IconRef | undefined {',
    "  return MODEL_ICON_KEYS.has(key) ? { kind: 'model', key } : undefined",
    '}',
    '',
    'export function resolveModelIconRef(modelId: string): IconRef | undefined {',
    '  if (!modelId) return undefined',
    '  for (const [regex, catalogKey] of MODEL_ICON_PATTERNS) {',
    '    if (regex.test(modelId)) return modelRef(catalogKey)',
    '  }',
    '  return undefined',
    '}',
    '',
    'export function resolveModelToProviderIconRef(modelId: string): IconRef | undefined {',
    '  if (!modelId) return undefined',
    '  for (const [regex, catalogKey] of MODEL_TO_PROVIDER_PATTERNS) {',
    '    if (regex.test(modelId)) return providerRef(catalogKey)',
    '  }',
    '  return undefined',
    '}',
    '',
    'export function resolveProviderIconRef(providerId: string): IconRef | undefined {',
    '  if (!providerId) return undefined',
    '  const normalizedId = providerId.toLowerCase()',
    '  const key = PROVIDER_ID_ALIASES[normalizedId] ?? normalizedId',
    '  return providerRef(key) ?? modelRef(key)',
    '}',
    '',
    'export function resolveIconRef(modelId: string, providerId: string): IconRef | undefined {',
    '  return resolveModelIconRef(modelId) ?? resolveModelToProviderIconRef(modelId) ?? resolveProviderIconRef(providerId)',
    '}',
    '',
  ].join('\n')

  fs.writeFileSync(path.join(TARGET_ICONS_DIR, 'registry.ts'), registry, 'utf8')
}

function generateIconLoader() {
  fs.writeFileSync(
    path.join(TARGET_ICONS_DIR, 'loader.ts'),
    [
      "import type { IconRef } from './registry'",
      "import type { ThemedIcon } from './types'",
      '',
      "type ModelCatalog = typeof import('./models/catalog')",
      "type ProviderCatalog = typeof import('./providers/catalog')",
      'let modelCatalog: ModelCatalog | undefined',
      'let providerCatalog: ProviderCatalog | undefined',
      'let modelCatalogPromise: Promise<ModelCatalog> | undefined',
      'let providerCatalogPromise: Promise<ProviderCatalog> | undefined',
      '',
      'export function getLoadedIcon(ref: IconRef): ThemedIcon | undefined {',
      "  return ref.kind === 'model'",
      '    ? modelCatalog?.MODEL_ICON_CATALOG[ref.key]',
      '    : providerCatalog?.PROVIDER_ICON_CATALOG[ref.key]',
      '}',
      '',
      'export async function loadIcon(ref: IconRef): Promise<ThemedIcon | undefined> {',
      "  if (ref.kind === 'model') {",
      "    modelCatalogPromise ??= import('./models/catalog').then((catalog) => {",
      '      modelCatalog = catalog',
      '      return catalog',
      '    })',
      '    return (await modelCatalogPromise).MODEL_ICON_CATALOG[ref.key]',
      '  }',
      '',
      "  providerCatalogPromise ??= import('./providers/catalog').then((catalog) => {",
      '    providerCatalog = catalog',
      '    return catalog',
      '  })',
      '  return (await providerCatalogPromise).PROVIDER_ICON_CATALOG[ref.key]',
      '}',
      '',
    ].join('\n'),
    'utf8'
  )
}

function extractConstSection(source, name, nextMarker) {
  const start = source.indexOf(`const ${name}`)
  const end = source.indexOf(nextMarker, start)
  if (start === -1 || end === -1) throw new Error(`Unable to parse ${name} from CherryStudio icon registry`)
  return source.slice(start, end).trim()
}

function parsePatternKeys(source) {
  return [...source.matchAll(/,\s*'([^']+)'\s*\]/g)].map((match) => match[1])
}

function trimConstObject(source) {
  const objectEnd = source.indexOf('\n}')
  if (objectEnd === -1) throw new Error('Unable to parse CherryStudio provider icon aliases')
  return source.slice(0, objectEnd + 2)
}

function parseAliases(source) {
  const aliases = new Map()
  const pattern = /(?:'([^']+)'|([\w-]+))\s*:\s*'([^']+)'/g
  for (const match of source.matchAll(pattern)) aliases.set(match[1] ?? match[2], match[3])
  return aliases
}

function readIconDirectoryKeys(kind) {
  return new Set(
    fs
      .readdirSync(path.join(repoDir, ICONS_SOURCE_DIR, kind), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  )
}

function preflightIcons(kind, keys) {
  for (const key of keys) {
    const lightPath = path.join(repoDir, ICONS_SOURCE_DIR, kind, key, 'light.tsx')
    if (!fs.existsSync(lightPath)) {
      throw new Error(`Invalid CherryStudio icon source: ${lightPath}`)
    }
    const content = fs.readFileSync(lightPath, 'utf8')
    if (!content.includes('export default') && !/export \{ \w+ \}/.test(content)) {
      throw new Error(`Icon has no importable component: ${lightPath}`)
    }
  }
}

function normalizeBaseUrl(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\/+$/, '') : ''
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoDir, relativePath), 'utf8'))
}
