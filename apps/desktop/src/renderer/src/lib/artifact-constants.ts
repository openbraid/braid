// ─── Shared artifact constants ───────────────────────────────────────────────
// Single source of truth for status styles, timing, validation, and display labels
// used across ChangelogView, StructuredTable, and artifact-validator.

// ─── Changelog ───────────────────────────────────────────────────────────────

/** Style for the 'affects' badge in changelog. Falls back to default if not recognized. */
export const AFFECTS_BADGE_STYLE = 'text-fg-secondary bg-surface-secondary border-border-subtle'

// ─── Timing ──────────────────────────────────────────────────────────────────

export const SAVE_INDICATOR_DURATION_MS = 2000
export const WRITE_DEBOUNCE_MS = 500

// ─── Rich text fields ───────────────────────────────────────────────────────

/** Fields stored as Y.XmlFragment (rich text with PM nodes), not Y.Text. */
export const RICH_TEXT_FIELDS = new Set(['description', 'context'])

// ─── Validation ─────────────────────────────────────────────────────────────

/** Top-level YAML keys that are recognized. Anything else triggers a warning. */
export const KNOWN_TOP_LEVEL_KEYS = new Set([
  'meta', 'context', 'requirements', 'task_list', 'test_cases', 'security_checks',
  'action_items', 'spec_coverage', 'test_coverage', 'change_log'
])

/**
 * Which array sections are allowed per artifact kind.
 * A section not in this map is allowed in all kinds.
 * context, change_log are allowed everywhere.
 */
export const KIND_RESTRICTED_SECTIONS: Record<string, string> = {
  requirements: 'REQUIREMENTS',
  task_list: 'SPEC',
  test_cases: 'TEST_PLAN',
  test_coverage: 'TEST_PLAN',
  security_checks: 'SECURITY',
  action_items: 'RCA',
  spec_coverage: 'SPEC',
}

/** Fuzzy match suggestions for common typos in top-level keys. */
export const TOP_LEVEL_KEY_SUGGESTIONS: Record<string, string> = {
  requirement: 'requirements',
  requirments: 'requirements',
  requirment: 'requirements',
  tasks: 'task_list',
  tasklist: 'task_list',
  task: 'task_list',
  testcases: 'test_cases',
  test_case: 'test_cases',
  testcase: 'test_cases',
  security: 'security_checks',
  checks: 'security_checks',
  actions: 'action_items',
  action: 'action_items',
  changelog: 'change_log',
  changes: 'change_log',
  spec: 'spec_coverage',
  analysis: 'spec_coverage',
  spec_analysis: 'spec_coverage',
  test_analysis: 'test_coverage',
}
