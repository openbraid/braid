// ─── YAML ↔ ProseMirror JSON conversion ─────────────────────────────────────
// Parses YAML artifact files into structured data for the renderer.
// Handles context block markdown ↔ ProseMirror JSON conversion via Tiptap.

import * as yaml from 'js-yaml'
import type { ArtifactKind, ArtifactMeta } from '../../../shared/ipc-types'
import { validateArtifact } from './artifact-validator'

// ─── Types ───────────────────────────────────────────────────────────────────

export type RequirementItem = {
  id: string
  title: string
  status: string
  priority: string
  tags?: string[]
  description: string
}

export type TaskItem = {
  id: string
  title: string
  status: string
  assignee?: string
  related_requirement?: string
  description: string
}

export type SpecCoverageItem = {
  requirement_id: string
  coverage_status: string
  gaps: string
}

export type ChangeLogEntry = {
  added: string
  removed: string
  why: string
  affects?: string
}

export type ParsedArtifact = {
  meta: ArtifactMeta
  contextBlocks: string[]
  requirements: RequirementItem[]
  taskList: TaskItem[]
  specCoverage: SpecCoverageItem[]
  changeLog: ChangeLogEntry[]
  testCases: Record<string, unknown>[]
  securityChecks: Record<string, unknown>[]
  actionItems: Record<string, unknown>[]
  testCoverage: Record<string, unknown>[]
}

export type ArtifactParseResult =
  | (ParsedArtifact & { errors: string[]; warnings: string[] })
  | { valid: false; errors: string[]; warnings: string[] }

// ─── Public API ──────────────────────────────────────────────────────────────

const KIND_REGEX = /^[A-Z][A-Z0-9_]*$/

/**
 * Parses a YAML artifact file into structured data + validation results.
 *
 * Always tries to extract as much data as possible, even when there are errors.
 * Only YAML syntax failure or missing document prevents data extraction.
 *
 * Returns:
 *   - On success (even with validation errors): ParsedArtifact + errors + warnings
 *   - On total failure (bad YAML syntax): { valid: false, errors, warnings }
 */
export function parseArtifactYaml(yamlString: string): ArtifactParseResult {
  let parsed: unknown
  try {
    parsed = yaml.load(yamlString)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { valid: false, errors: [`Invalid YAML syntax: ${message}`], warnings: [] }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, errors: ['YAML document must be an object — check that the file starts with "meta:"'], warnings: [] }
  }

  const doc = parsed as Record<string, unknown>

  // Run full validation
  const { errors, warnings } = validateArtifact(doc)

  // Extract meta (best-effort even if validation failed)
  const rawMeta = (doc.meta && typeof doc.meta === 'object') ? doc.meta as Record<string, unknown> : {}
  const kindStr = typeof rawMeta.kind === 'string' ? rawMeta.kind : ''
  const meta: ArtifactMeta = {
    kind: (KIND_REGEX.test(kindStr) ? kindStr : '') as ArtifactKind,
    title: typeof rawMeta.title === 'string' ? rawMeta.title : ''
  }

  // If meta is completely invalid, we can't meaningfully parse — return early
  if (!meta.kind) {
    return { valid: false, errors, warnings }
  }

  // Extract blocks (best-effort — skip malformed items, validator already reported them)
  const contextBlocks = extractContextBlocks(doc)
  const requirements = extractRequirementItems(doc)
  const taskList = extractTaskItems(doc)
  const specCoverage = extractGenericItems(doc.spec_coverage) as unknown as SpecCoverageItem[]
  const changeLog = extractChangeLogItems(doc)
  const testCases = extractGenericItems(doc.test_cases)
  const securityChecks = extractGenericItems(doc.security_checks)
  const actionItems = extractGenericItems(doc.action_items)
  const testCoverage = extractGenericItems(doc.test_coverage)

  return { meta, contextBlocks, requirements, taskList, specCoverage, changeLog, testCases, securityChecks, actionItems, testCoverage, errors, warnings }
}

// ─── Block Extraction (best-effort) ─────────────────────────────────────────

function extractContextBlocks(doc: Record<string, unknown>): string[] {
  if (typeof doc.context === 'string') return [doc.context]
  if (Array.isArray(doc.context)) {
    return doc.context.filter((item): item is string => typeof item === 'string')
  }
  return []
}

function extractRequirementItems(doc: Record<string, unknown>): RequirementItem[] {
  return extractGenericItems(doc.requirements) as RequirementItem[]
}

function extractTaskItems(doc: Record<string, unknown>): TaskItem[] {
  return extractGenericItems(doc.task_list) as TaskItem[]
}

/**
 * Extract all fields from array items — no hardcoded field list.
 * Preserves every YAML key so the StructuredTable can render dynamic columns.
 *
 * What comes out here is what gets written back by `reconstructYaml`, so this
 * function decides what survives a load/save cycle. Two rules follow from that:
 *
 *   - Nested structures are preserved as-is. Coercing them with String() turns
 *     a mapping into the literal "[object Object]", and because the result is
 *     serialised straight back to the user's file, the original content is
 *     destroyed on the next save. The table stringifies for display anyway
 *     (see StructuredTable), so nothing is gained by doing it this early.
 *   - `id`/`title` are only defaulted for sections that actually have them.
 *     Adding them everywhere writes empty `id:`/`title:` keys into sections
 *     like change_log that have no such fields.
 */
function extractGenericItems(
  arr: unknown,
  { identified = true }: { identified?: boolean } = {}
): Record<string, unknown>[] {
  if (!Array.isArray(arr)) return []
  const items: Record<string, unknown>[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const obj: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw)) {
      obj[key] = normalizeItemValue(value)
    }
    if (identified) {
      if (obj.id === undefined) obj.id = ''
      if (obj.title === undefined) obj.title = ''
    }
    items.push(obj)
  }
  return items
}

/**
 * Scalars become strings — the table edits them as text, and YAML round-trips
 * them unchanged. Nested mappings and the objects inside arrays are handed back
 * untouched so they survive to be written out again. An explicit YAML null
 * becomes '' because the editor treats a cleared field as an empty string.
 */
function normalizeItemValue(value: unknown): unknown {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(normalizeItemValue)
  if (typeof value === 'object') return value
  return String(value)
}

function extractChangeLogItems(doc: Record<string, unknown>): ChangeLogEntry[] {
  // Changelog entries are {added, removed, why, affects} — they carry no id or
  // title, so defaulting those would write two empty keys into every entry.
  return extractGenericItems(doc.change_log, { identified: false }) as unknown as ChangeLogEntry[]
}

/**
 * Reconstructs a YAML string from parsed artifact data.
 * Context markdown is placed back into the context block.
 * Structured blocks are serialized from their typed objects.
 */
/** Pass all fields from an item through to YAML — no hardcoded field list. */
function passAllFields(item: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (value === undefined) continue
    // Skip empty arrays (tags: [])
    if (Array.isArray(value) && value.length === 0) continue
    result[key] = value
  }
  return result
}

/**
 * Reconstructs a YAML string from artifact meta, context markdown, and structured blocks.
 * `structuredBlocks` uses snake_case YAML keys (e.g. 'requirements', 'task_list', 'change_log').
 */
export function reconstructYaml(
  meta: ArtifactMeta,
  contextMarkdown: string,
  structuredBlocks: Record<string, Record<string, unknown>[]>
): string {
  const doc: Record<string, unknown> = {
    meta: {
      kind: meta.kind,
      title: meta.title
    }
  }

  // Context
  if (contextMarkdown.trim()) {
    doc.context = contextMarkdown
  }

  // Write all structured array sections
  for (const [yamlKey, items] of Object.entries(structuredBlocks)) {
    if (items && items.length > 0) {
      doc[yamlKey] = items.map(passAllFields)
    }
  }

  return yaml.dump(doc, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false
  })
}

/**
 * Builds the structured blocks object from a ParsedArtifact.
 * Returns snake_case YAML keys. Accepts optional overrides keyed by snake_case YAML name.
 */
export function buildStructuredBlocks(
  artifact: ParsedArtifact,
  overrides?: Record<string, Record<string, unknown>[]>
): Record<string, Record<string, unknown>[]> {
  const result: Record<string, Record<string, unknown>[]> = {}

  // Map camelCase ParsedArtifact fields to snake_case YAML keys
  const sections: Array<[string, Record<string, unknown>[]]> = [
    ['requirements', artifact.requirements],
    ['task_list', artifact.taskList],
    ['spec_coverage', artifact.specCoverage],
    ['change_log', artifact.changeLog],
    ['test_cases', artifact.testCases],
    ['security_checks', artifact.securityChecks],
    ['action_items', artifact.actionItems],
    ['test_coverage', artifact.testCoverage],
  ]

  for (const [yamlKey, items] of sections) {
    const data = overrides?.[yamlKey] ?? items
    if (data.length > 0) {
      result[yamlKey] = data
    }
  }

  return result
}

/**
 * Validates a YAML string without fully parsing it.
 * Returns errors and warnings.
 */
export function validateArtifactYaml(yamlString: string): { valid: boolean; errors: string[]; warnings: string[] } {
  const result = parseArtifactYaml(yamlString)
  if ('valid' in result && result.valid === false) {
    return { valid: false, errors: result.errors, warnings: result.warnings }
  }
  return { valid: result.errors.length === 0, errors: result.errors, warnings: result.warnings }
}
