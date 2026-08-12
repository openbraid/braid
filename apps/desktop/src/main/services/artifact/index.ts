// ─── Artifact file service ────────────────────────────────────────────────────
// Reads, writes, and validates YAML artifact files in .braid/{workspaceName}/.
// All operations are file-system level — no database, no backend calls.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, renameSync } from 'fs'
import { join, extname } from 'path'
import { createHash } from 'crypto'
import * as yaml from 'js-yaml'

import type {
  ArtifactKind,
  ArtifactMeta,
  ArtifactFileEntry,
  ArtifactFileError,
  ArtifactListResult
} from '../../../shared/ipc-types'
import { deriveArtifactFilePath } from '../../lib/derive-paths'
import { getArtifactTemplate, DEFAULT_PIPELINE } from './templates'
import { setLastWrittenHash } from './file-watcher'

const MAX_YAML_BYTES = 2 * 1024 * 1024 // 2 MB hard limit
const MAX_FILES_SCAN = 50
const KIND_REGEX = /^[A-Z][A-Z0-9_]*$/

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Scans .braid/{workspaceName}/ for YAML files and returns parsed artifact metadata.
 * Skips files that fail to parse and reports them as errors.
 * Flags duplicate kinds so the renderer can show a warning banner.
 */
export function listArtifactFiles(braidDir: string): ArtifactListResult {
  const artifacts: ArtifactFileEntry[] = []
  const errors: ArtifactFileError[] = []
  const kindCounts = new Map<ArtifactKind, number>()

  if (!existsSync(braidDir)) {
    return { artifacts, errors, duplicateKinds: [] }
  }

  let entries: string[]
  try {
    entries = readdirSync(braidDir)
  } catch (err) {
    console.error(`[artifact] Failed to read directory ${braidDir}:`, err)
    return { artifacts, errors, duplicateKinds: [] }
  }

  const yamlFiles = entries
    .filter((f) => {
      const ext = extname(f).toLowerCase()
      return ext === '.yaml' || ext === '.yml'
    })
    .slice(0, MAX_FILES_SCAN)

  for (const fileName of yamlFiles) {
    const filePath = join(braidDir, fileName)

    try {
      const stat = statSync(filePath)
      if (!stat.isFile()) continue
      if (stat.size > MAX_YAML_BYTES) {
        errors.push({ fileName, error: `File exceeds ${MAX_YAML_BYTES / 1024 / 1024}MB limit` })
        continue
      }

      const raw = readFileSync(filePath, 'utf-8')
      const meta = extractMeta(raw)
      if (!meta) {
        errors.push({ fileName, error: 'Missing or invalid meta block (requires kind and title)' })
        continue
      }

      artifacts.push({
        kind: meta.kind,
        title: meta.title,
        fileName,
        sizeBytes: stat.size
      })

      kindCounts.set(meta.kind, (kindCounts.get(meta.kind) ?? 0) + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ fileName, error: `Parse error: ${message}` })
    }
  }

  const duplicateKinds = [...kindCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([kind]) => kind)

  return { artifacts, errors, duplicateKinds }
}

/**
 * Reads a specific artifact YAML file by kind.
 * Scans all files and matches by meta.kind (file name is a convention, not identity).
 */
export function readArtifactFile(
  braidDir: string,
  kind: ArtifactKind
): { yamlContent: string; meta: ArtifactMeta } | null {
  if (!existsSync(braidDir)) return null

  const entries = readdirSync(braidDir)
  const yamlFiles = entries.filter((f) => {
    const ext = extname(f).toLowerCase()
    return ext === '.yaml' || ext === '.yml'
  })

  for (const fileName of yamlFiles) {
    const filePath = join(braidDir, fileName)
    try {
      const stat = statSync(filePath)
      if (!stat.isFile() || stat.size > MAX_YAML_BYTES) continue

      const yamlContent = readFileSync(filePath, 'utf-8')
      const meta = extractMeta(yamlContent)
      if (meta && meta.kind === kind) {
        return { yamlContent, meta }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return null
}

/**
 * Writes a YAML artifact file to disk.
 * Validates the content before writing. Uses atomic write (tmp + rename).
 * Updates the file watcher hash cache to suppress own-write events.
 */
export function writeArtifactFile(
  braidDir: string,
  kind: ArtifactKind,
  yamlContent: string
): { success: boolean; error?: string } {
  // Validate content size
  const sizeBytes = Buffer.byteLength(yamlContent, 'utf-8')
  if (sizeBytes > MAX_YAML_BYTES) {
    return { success: false, error: `Content exceeds ${MAX_YAML_BYTES / 1024 / 1024}MB limit` }
  }

  // Validate YAML structure
  const validation = validateYaml(yamlContent)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  // Validate the kind in the YAML matches what we expect
  const meta = extractMeta(yamlContent)
  if (!meta || meta.kind !== kind) {
    return { success: false, error: `meta.kind "${meta?.kind}" does not match expected "${kind}"` }
  }

  // Determine file path — find existing file for this kind, or use convention
  const filePath = findFileForKind(braidDir, kind) ?? deriveArtifactFilePath(braidDir, kind)

  // Ensure directory exists
  if (!existsSync(braidDir)) {
    mkdirSync(braidDir, { recursive: true })
  }

  // Atomic write: write to .tmp, then rename
  const tmpPath = `${filePath}.tmp`
  try {
    writeFileSync(tmpPath, yamlContent, 'utf-8')
    renameSync(tmpPath, filePath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Write failed: ${message}` }
  }

  // Update hash cache so file watcher ignores our own write
  const hash = contentHash(yamlContent)
  setLastWrittenHash(filePath, hash)

  console.log(`[artifact] Wrote ${kind} to ${filePath} (${sizeBytes} bytes)`)
  return { success: true }
}

/**
 * Creates .braid/{workspaceName}/ directory and seeds YAML templates
 * for each artifact kind in the pipeline. Idempotent — skips files that exist.
 * Returns the list of newly seeded artifact kinds.
 */
export function initArtifactFolder(
  braidDir: string,
  pipeline: ArtifactKind[] = DEFAULT_PIPELINE
): { braidDir: string; seededArtifacts: ArtifactKind[] } {
  if (!existsSync(braidDir)) {
    mkdirSync(braidDir, { recursive: true })
    console.log(`[artifact] Created artifact folder: ${braidDir}`)
  }

  const seeded: ArtifactKind[] = []

  for (const kind of pipeline) {
    const filePath = deriveArtifactFilePath(braidDir, kind)
    if (existsSync(filePath)) continue

    const template = getArtifactTemplate(kind)
    writeFileSync(filePath, template, 'utf-8')
    seeded.push(kind)
  }

  if (seeded.length > 0) {
    console.log(`[artifact] Seeded templates: ${seeded.join(', ')}`)
  }

  return { braidDir, seededArtifacts: seeded }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Extracts the meta block from a YAML string.
 * Returns null if meta is missing, invalid, or kind doesn't match rules.
 */
function extractMeta(yamlContent: string): ArtifactMeta | null {
  try {
    const parsed = yaml.load(yamlContent) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return null

    const meta = parsed.meta as Record<string, unknown> | undefined
    if (!meta || typeof meta !== 'object') return null

    const kind = meta.kind
    const title = meta.title

    if (typeof kind !== 'string') return null
    if (!KIND_REGEX.test(kind)) return null
    if (kind.length > 50) return null
    if (typeof title !== 'string') return null

    return { kind: kind as ArtifactKind, title }
  } catch {
    return null
  }
}

function validateYaml(yamlContent: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Try parsing
  let parsed: unknown
  try {
    parsed = yaml.load(yamlContent)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.push(`Invalid YAML syntax: ${message}`)
    return { valid: false, errors }
  }

  if (!parsed || typeof parsed !== 'object') {
    errors.push('YAML document must be an object')
    return { valid: false, errors }
  }

  const doc = parsed as Record<string, unknown>

  // Check meta block
  if (!doc.meta || typeof doc.meta !== 'object') {
    errors.push('Missing required "meta" block')
  } else {
    const meta = doc.meta as Record<string, unknown>
    if (typeof meta.kind !== 'string' || !KIND_REGEX.test(meta.kind)) {
      errors.push('meta.kind must be uppercase alphanumeric with underscores')
    }
    if (meta.kind && (meta.kind as string).length > 50) {
      errors.push('meta.kind must be 50 characters or fewer')
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Finds the file path for an existing artifact of the given kind.
 * Scans all YAML files in the directory and matches by meta.kind.
 */
function findFileForKind(braidDir: string, kind: ArtifactKind): string | null {
  if (!existsSync(braidDir)) return null

  try {
    const entries = readdirSync(braidDir)
    for (const fileName of entries) {
      const ext = extname(fileName).toLowerCase()
      if (ext !== '.yaml' && ext !== '.yml') continue

      const filePath = join(braidDir, fileName)
      const stat = statSync(filePath)
      if (!stat.isFile()) continue

      const content = readFileSync(filePath, 'utf-8')
      const meta = extractMeta(content)
      if (meta?.kind === kind) return filePath
    }
  } catch {
    // Directory read error
  }

  return null
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
