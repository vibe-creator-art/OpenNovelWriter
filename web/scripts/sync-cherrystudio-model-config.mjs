import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Syncs CherryStudio's model capability detection into
// src/lib/cherrystudio-model-config/models/.
//
// CherryStudio (>= 2026-06) keeps the detection logic in
// `src/shared/utils/model.ts` (capability checks + model-ID inference) and the
// catalog data in the `@cherrystudio/provider-registry` workspace package.
// We vendor the four self-contained source files and generate a compact
// capability lookup table from the registry catalog data. All cross-package
// imports are rewritten to the hand-written shims under ../runtime/.
//
// Usage: node scripts/sync-cherrystudio-model-config.mjs [cherry-studio-repo-root]

const ROOT_DIR = process.cwd()
const DEFAULT_REPO_DIR = path.resolve(ROOT_DIR, '..', '..', 'cherry-studio')
const TARGET_DIR = path.resolve(ROOT_DIR, 'src', 'lib', 'cherrystudio-model-config', 'models')

const repoDir = process.argv[2] ? path.resolve(ROOT_DIR, process.argv[2]) : DEFAULT_REPO_DIR

const SYNCED_FILES = [
  { source: 'src/shared/utils/model.ts', target: 'model.ts' },
  { source: 'src/renderer/config/models/bridge.ts', target: 'bridge.ts' },
  { source: 'packages/provider-registry/src/patterns/vendor-patterns.ts', target: 'vendor-patterns.ts' },
  { source: 'packages/provider-registry/src/utils/normalize.ts', target: 'normalize.ts' },
]

const REGISTRY_DATA_FILE = 'packages/provider-registry/data/models.json'

if (!fs.existsSync(repoDir)) {
  console.error(`CherryStudio repository not found: ${repoDir}`)
  process.exit(1)
}

fs.mkdirSync(TARGET_DIR, { recursive: true })

for (const { source, target } of SYNCED_FILES) {
  const sourcePath = path.join(repoDir, source)
  if (!fs.existsSync(sourcePath)) {
    console.error(`Missing CherryStudio source file: ${sourcePath}`)
    process.exit(1)
  }

  const transformed = transformSource(fs.readFileSync(sourcePath, 'utf8'))

  fs.writeFileSync(
    path.join(TARGET_DIR, target),
    [
      '// This file is synced from CherryStudio by `npm run sync:cherrystudio-model-config`.',
      '// Do not edit it by hand; re-run the sync script instead.',
      `// Source: cherry-studio/${source}`,
      '',
      transformed,
    ].join('\n'),
    'utf8'
  )
}

generateRegistryCapabilities()

console.log(`Synced CherryStudio model config from ${repoDir}`)

function transformSource(source) {
  let next = source

  // Shared type/enum package -> hand-written shim.
  next = next.replaceAll("'@shared/data/types/model'", "'../runtime/shared-model-types'")
  // provider-registry exports (MODALITY, VENDOR_PATTERNS, Modality, ...) are
  // re-exported by the same shim.
  next = next.replaceAll("'@cherrystudio/provider-registry'", "'../runtime/shared-model-types'")
  // Detection logic itself.
  next = next.replaceAll("'@shared/utils/model'", "'./model'")
  // Renderer v1 Model (bridge input shape).
  next = next.replaceAll("'@renderer/types'", "'../runtime/types'")

  return next
}

function generateRegistryCapabilities() {
  const dataPath = path.join(repoDir, REGISTRY_DATA_FILE)
  if (!fs.existsSync(dataPath)) {
    console.error(`Missing CherryStudio registry data: ${dataPath}`)
    process.exit(1)
  }

  const { models, version } = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

  // Bit layout mirrors the runtime checks in model.ts:
  //   vision          = IMAGE_RECOGNITION capability or IMAGE input modality
  //   reasoning       = REASONING capability or a reasoning config
  //   tool            = FUNCTION_CALL capability
  //   reranker        = RERANK capability
  //   embedding       = EMBEDDING capability
  //   imageGeneration = IMAGE_GENERATION capability
  // Duplicate ids exist in the catalog; like RegistryLoader's Map.set, the
  // last occurrence wins. Entries whose flags come out as 0 are dropped: the
  // catalog contains incomplete records (e.g. gemini image models with no
  // capabilities listed), and an entry asserting nothing must not shadow the
  // model-id inference fallback.
  const flagsById = new Map()
  for (const model of models) {
    const capabilities = model.capabilities ?? []
    const inputModalities = model.inputModalities ?? []

    let flags = 0
    if (capabilities.includes('image-recognition') || inputModalities.includes('image')) flags |= 1
    if (capabilities.includes('reasoning') || model.reasoning != null) flags |= 2
    if (capabilities.includes('function-call')) flags |= 4
    if (capabilities.includes('rerank')) flags |= 8
    if (capabilities.includes('embedding')) flags |= 16
    if (capabilities.includes('image-generation')) flags |= 32

    if (flags === 0) {
      flagsById.delete(model.id)
      continue
    }
    flagsById.set(model.id, flags)
  }

  const lines = [...flagsById]
    .map(([id, flags]) => `  ${JSON.stringify(id)}: ${flags},`)
    .sort()

  fs.writeFileSync(
    path.join(TARGET_DIR, 'registry-capabilities.ts'),
    [
      '// This file is generated from CherryStudio provider-registry data by',
      '// `npm run sync:cherrystudio-model-config`. Do not edit it by hand.',
      `// Source: cherry-studio/${REGISTRY_DATA_FILE} (version ${version})`,
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
      ...lines,
      '}',
      '',
    ].join('\n'),
    'utf8'
  )
}
