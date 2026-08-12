/**
 * column-utils.ts
 *
 * Heuristics for deciding whether a table column should render as a
 * dropdown (combobox) or a plain text input. The goal is to auto-detect
 * "enum-like" columns — fields whose values come from a small, finite set —
 * without requiring explicit schema metadata.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum number of rows before we consider dropdown rendering. */
const MIN_ROWS = 3

/** Minimum distinct non-empty values required to justify a dropdown. */
const MIN_UNIQUE_VALUES = 2

/** Maximum distinct non-empty values — beyond this the dropdown becomes unwieldy. */
const MAX_UNIQUE_VALUES = 8

/**
 * If more than this fraction of non-empty values look like dates or numbers,
 * we treat the column as non-categorical and skip the dropdown.
 */
const NUMERIC_OR_DATE_THRESHOLD = 0.5

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Common date patterns we want to exclude from dropdown consideration.
 * Covers ISO (YYYY-MM-DD), US (MM/DD/YYYY), EU (DD/MM/YYYY), and a few
 * variants with dots or short years.
 */
const DATE_PATTERNS: RegExp[] = [
  // YYYY-MM-DD (ISO 8601)
  /^\d{4}-\d{1,2}-\d{1,2}$/,
  // MM/DD/YYYY or DD/MM/YYYY
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  // MM-DD-YYYY or DD-MM-YYYY
  /^\d{1,2}-\d{1,2}-\d{2,4}$/,
  // DD.MM.YYYY (common in EU)
  /^\d{1,2}\.\d{1,2}\.\d{2,4}$/,
  // Month name forms: "Jan 1, 2024", "January 1 2024", etc.
  /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}$/,
]

/** Returns true if the trimmed string looks like a date. */
function looksLikeDate(value: string): boolean {
  const trimmed = value.trim()
  return DATE_PATTERNS.some((pattern) => pattern.test(trimmed))
}

/** Returns true if the trimmed string is purely numeric (integer or decimal). */
function looksLikeNumber(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  return /^-?\d+(\.\d+)?$/.test(trimmed)
}

/**
 * Coerce an unknown cell value to a trimmed string.
 * Returns an empty string for null, undefined, or non-string/non-number types.
 */
function toStringValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine whether a table column should render as a dropdown or text input.
 *
 * Heuristic:
 * 1. The table must have at least {@link MIN_ROWS} rows.
 * 2. The column must contain between {@link MIN_UNIQUE_VALUES} and
 *    {@link MAX_UNIQUE_VALUES} distinct non-empty values (inclusive).
 * 3. The majority of non-empty values must NOT look like dates or bare numbers,
 *    since those are better served by specialised inputs.
 *
 * @param items - The full array of table row objects.
 * @param field - The column key to inspect.
 * @returns `'dropdown'` if the column looks categorical, `'text'` otherwise.
 */
export function getColumnRenderMode(
  items: Array<Record<string, unknown>>,
  field: string,
): 'dropdown' | 'text' {
  // Rule 1: need enough rows to infer a pattern.
  if (items.length < MIN_ROWS) {
    return 'text'
  }

  // Collect all non-empty string representations for this field.
  const nonEmptyValues: string[] = []
  for (const item of items) {
    const str = toStringValue(item[field])
    if (str !== '') {
      nonEmptyValues.push(str)
    }
  }

  // Rule 2: check unique-value count is within range.
  const uniqueValues = new Set(nonEmptyValues)
  if (uniqueValues.size < MIN_UNIQUE_VALUES || uniqueValues.size > MAX_UNIQUE_VALUES) {
    return 'text'
  }

  // Rule 3: reject if most non-empty values look like dates or numbers.
  if (nonEmptyValues.length > 0) {
    const dateOrNumberCount = nonEmptyValues.filter(
      (v) => looksLikeDate(v) || looksLikeNumber(v),
    ).length
    if (dateOrNumberCount / nonEmptyValues.length > NUMERIC_OR_DATE_THRESHOLD) {
      return 'text'
    }
  }

  return 'dropdown'
}

/**
 * Extract the sorted list of unique non-empty string values for a column.
 * Useful for populating a dropdown/combobox option list.
 *
 * @param items - The full array of table row objects.
 * @param field - The column key to collect values from.
 * @returns Alphabetically sorted array of distinct non-empty strings.
 */
export function getDropdownOptions(
  items: Array<Record<string, unknown>>,
  field: string,
): string[] {
  const seen = new Set<string>()
  for (const item of items) {
    const str = toStringValue(item[field])
    if (str !== '') {
      seen.add(str)
    }
  }
  return Array.from(seen).sort()
}
