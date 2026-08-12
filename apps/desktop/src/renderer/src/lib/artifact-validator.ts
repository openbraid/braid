// ─── Artifact YAML Validator ─────────────────────────────────────────────────
// Validates a parsed YAML document and returns all errors and warnings.
// Errors block save. Warnings are informational.
//
// Runs on every YAML parse (load from disk, load from server, file change).
// Collects all issues in a single pass — no whack-a-mole.

import {
  KNOWN_TOP_LEVEL_KEYS,
  KIND_RESTRICTED_SECTIONS,
  TOP_LEVEL_KEY_SUGGESTIONS,
} from './artifact-constants'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValidationResult {
  errors: string[]
  warnings: string[]
}

const KIND_REGEX = /^[A-Z][A-Z0-9_]*$/

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate a raw YAML document (already parsed by js-yaml into a JS object).
 * Returns all errors and warnings found.
 */
export function validateArtifact(doc: Record<string, unknown>): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  validateMeta(doc, errors)
  validateContext(doc, errors)
  validateTopLevelKeys(doc, warnings)
  validateKindRestrictedSections(doc, errors)
  validateRequirements(doc, errors, warnings)
  validateTaskList(doc, errors, warnings)
  validateChangeLog(doc, errors)
  validateSpecCoverage(doc, errors)
  validateTestCases(doc, errors, warnings)
  validateSecurityChecks(doc, errors, warnings)
  validateActionItems(doc, errors, warnings)
  validateTestCoverage(doc, errors)

  return { errors, warnings }
}

// ─── Meta ────────────────────────────────────────────────────────────────────

function validateMeta(doc: Record<string, unknown>, errors: string[]): void {
  if (!doc.meta || typeof doc.meta !== 'object') {
    errors.push('Missing "meta" block — every artifact needs a meta section with kind and title')
    return
  }

  const meta = doc.meta as Record<string, unknown>

  if (typeof meta.kind !== 'string' || !KIND_REGEX.test(meta.kind)) {
    errors.push('meta.kind must be uppercase letters, numbers, and underscores (e.g. REQUIREMENTS, SPEC)')
  } else if (meta.kind.length > 50) {
    errors.push('meta.kind is too long — must be 50 characters or fewer')
  }

  if (typeof meta.title !== 'string' || meta.title.trim().length === 0) {
    errors.push('meta.title is required — add a descriptive title for this artifact')
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

function validateContext(doc: Record<string, unknown>, errors: string[]): void {
  if (doc.context === undefined || doc.context === null) return

  if (typeof doc.context !== 'string' && !Array.isArray(doc.context)) {
    errors.push('context must be a text block (string), not a ' + typeof doc.context)
    return
  }

  if (Array.isArray(doc.context)) {
    for (let i = 0; i < doc.context.length; i++) {
      if (typeof doc.context[i] !== 'string') {
        errors.push(`context[${i}] must be a string, not ${typeof doc.context[i]}`)
      }
    }
  }
}

// ─── Top-level keys ──────────────────────────────────────────────────────────

function validateTopLevelKeys(doc: Record<string, unknown>, warnings: string[]): void {
  for (const key of Object.keys(doc)) {
    if (KNOWN_TOP_LEVEL_KEYS.has(key)) continue

    const suggestion = TOP_LEVEL_KEY_SUGGESTIONS[key.toLowerCase()]
    if (suggestion) {
      warnings.push(`"${key}" is not recognized — did you mean "${suggestion}"?`)
    } else {
      warnings.push(`"${key}" is not a recognized section — it will be ignored`)
    }
  }
}

// ─── Kind-restricted sections ────────────────────────────────────────────────

function validateKindRestrictedSections(doc: Record<string, unknown>, errors: string[]): void {
  const meta = doc.meta as Record<string, unknown> | undefined
  const kind = typeof meta?.kind === 'string' ? meta.kind : ''

  for (const [section, allowedKind] of Object.entries(KIND_RESTRICTED_SECTIONS)) {
    const value = doc[section]
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue

    if (kind && kind !== allowedKind) {
      errors.push(
        `"${section}" is only allowed in ${allowedKind} artifacts — ` +
        `remove it or change meta.kind to ${allowedKind}`
      )
    }
  }
}

// ─── Requirements ────────────────────────────────────────────────────────────

function validateRequirements(
  doc: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): void {
  if (doc.requirements === undefined || doc.requirements === null) return

  if (!Array.isArray(doc.requirements)) {
    errors.push('requirements must be a list, not ' + typeof doc.requirements)
    return
  }

  validateItemArray(doc.requirements, 'requirements', 'Requirement', errors, warnings)
}

// ─── Task list ───────────────────────────────────────────────────────────────

function validateTaskList(
  doc: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): void {
  if (doc.task_list === undefined || doc.task_list === null) return

  if (!Array.isArray(doc.task_list)) {
    errors.push('task_list must be a list, not ' + typeof doc.task_list)
    return
  }

  validateItemArray(doc.task_list, 'task_list', 'Task', errors, warnings)
}

// ─── Change log ──────────────────────────────────────────────────────────────

function validateChangeLog(doc: Record<string, unknown>, errors: string[]): void {
  if (doc.change_log === undefined || doc.change_log === null) return

  if (!Array.isArray(doc.change_log)) {
    errors.push('change_log must be a list, not ' + typeof doc.change_log)
    return
  }

  for (let i = 0; i < doc.change_log.length; i++) {
    if (!doc.change_log[i] || typeof doc.change_log[i] !== 'object') {
      errors.push(`change_log[${i}] must be an object with fields like added, removed, why`)
    }
  }
}

// ─── Spec coverage ──────────────────────────────────────────────────────────

function validateSpecCoverage(doc: Record<string, unknown>, errors: string[]): void {
  if (doc.spec_coverage === undefined || doc.spec_coverage === null) return

  if (!Array.isArray(doc.spec_coverage)) {
    errors.push('spec_coverage must be a list, not ' + typeof doc.spec_coverage)
    return
  }

  for (let i = 0; i < doc.spec_coverage.length; i++) {
    if (!doc.spec_coverage[i] || typeof doc.spec_coverage[i] !== 'object') {
      errors.push(`spec_coverage[${i}] must be an object with requirement_id, coverage_status, gaps`)
    }
  }
}

// ─── Test cases ─────────────────────────────────────────────────────────────

function validateTestCases(
  doc: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): void {
  if (doc.test_cases === undefined || doc.test_cases === null) return

  if (!Array.isArray(doc.test_cases)) {
    errors.push('test_cases must be a list, not ' + typeof doc.test_cases)
    return
  }

  validateItemArray(doc.test_cases, 'test_cases', 'Test case', errors, warnings)
}

// ─── Security checks ───────────────────────────────────────────────────────

function validateSecurityChecks(
  doc: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): void {
  if (doc.security_checks === undefined || doc.security_checks === null) return

  if (!Array.isArray(doc.security_checks)) {
    errors.push('security_checks must be a list, not ' + typeof doc.security_checks)
    return
  }

  validateItemArray(doc.security_checks, 'security_checks', 'Security check', errors, warnings)
}

// ─── Action items ───────────────────────────────────────────────────────────

function validateActionItems(
  doc: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): void {
  if (doc.action_items === undefined || doc.action_items === null) return

  if (!Array.isArray(doc.action_items)) {
    errors.push('action_items must be a list, not ' + typeof doc.action_items)
    return
  }

  validateItemArray(doc.action_items, 'action_items', 'Action item', errors, warnings)
}

// ─── Test coverage ──────────────────────────────────────────────────────────

function validateTestCoverage(doc: Record<string, unknown>, errors: string[]): void {
  if (doc.test_coverage === undefined || doc.test_coverage === null) return

  if (!Array.isArray(doc.test_coverage)) {
    errors.push('test_coverage must be a list, not ' + typeof doc.test_coverage)
    return
  }

  for (let i = 0; i < doc.test_coverage.length; i++) {
    if (!doc.test_coverage[i] || typeof doc.test_coverage[i] !== 'object') {
      errors.push(`test_coverage[${i}] must be an object`)
    }
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Validate an array of items (requirements or tasks).
 * Checks: items are objects, required fields, ID rules, uniqueness.
 * Calls `extraChecks` for type-specific validation (status, priority enums).
 */
function validateItemArray(
  items: unknown[],
  sectionName: string,
  itemLabel: string,
  errors: string[],
  _warnings: string[],
): void {
  const seenIds = new Map<string, number>() // id → first occurrence index

  for (let i = 0; i < items.length; i++) {
    const raw = items[i]

    if (!raw || typeof raw !== 'object') {
      errors.push(`${sectionName}[${i}] must be an object, not ${typeof raw}`)
      continue
    }

    const item = raw as Record<string, unknown>
    const id = item.id
    const label = typeof id === 'string' && id ? `${itemLabel} "${id}"` : `${sectionName}[${i}]`

    // Required: id
    if (id === undefined || id === null || (typeof id === 'string' && id.trim() === '')) {
      errors.push(`${sectionName}[${i}] is missing an id — every ${itemLabel.toLowerCase()} must have a unique id`)
      continue
    }

    const idStr = String(id)

    // ID must not contain ":"
    if (idStr.includes(':')) {
      errors.push(`${label} has an id containing ":" which is not allowed — use dashes or underscores instead`)
    }

    // Unique IDs
    if (seenIds.has(idStr)) {
      const firstIdx = seenIds.get(idStr)!
      errors.push(
        `${sectionName}[${i}] and ${sectionName}[${firstIdx}] both have id "${idStr}" — each ${itemLabel.toLowerCase()} must have a unique id`
      )
    } else {
      seenIds.set(idStr, i)
    }

    // Required: title
    if (typeof item.title !== 'string' || item.title.trim() === '') {
      errors.push(`${label} is missing a title`)
    }

  }
}
