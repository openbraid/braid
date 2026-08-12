// ─── Editor constants ────────────────────────────────────────────────────────
// Shared constants for the artifact editor system. No magic numbers.

/** Data attribute used to identify the editor container for position calculations. */
export const EDITOR_CONTAINER_ATTR = 'data-editor-container'

/** Selector for finding the editor container. */
export const EDITOR_CONTAINER_SELECTOR = `[${EDITOR_CONTAINER_ATTR}]`

/** Gap (px) between the anchor text and the popover/bubble below it. */
export const POPOVER_GAP_PX = 8

/** Offset (px) above a table for the table toolbar. */
export const TABLE_TOOLBAR_OFFSET_PX = 32

/** Debounce delay (ms) for content changes before writing to YAML. */
export const CONTENT_CHANGE_DEBOUNCE_MS = 800

/** Duration (ms) the "Saved" indicator stays visible before fading. */
export const SAVED_INDICATOR_DURATION_MS = 2000

/** Interval (ms) between server version polling checks. */
export const SERVER_POLL_INTERVAL_MS = 30_000

/** Delay (ms) before focusing an input after mount (allows DOM to settle). */
export const FOCUS_DELAY_MS = 50

/** Max lines for auto-growing textareas (comment reply, etc.). */
export const TEXTAREA_MAX_LINES = 4

/** Line height (px) used for textarea auto-resize calculation. */
export const TEXTAREA_LINE_HEIGHT_PX = 18

/** Padding (px) included in textarea auto-resize calculation. */
export const TEXTAREA_PADDING_PX = 12
