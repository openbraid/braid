// ─── Editor utilities ────────────────────────────────────────────────────────
// Shared utility functions for the artifact editor system.

import type { EditorView } from '@tiptap/pm/view'
import { EDITOR_CONTAINER_SELECTOR, POPOVER_GAP_PX } from './editor-constants'

/**
 * Computes a position relative to the editor container for floating elements
 * (comment bubbles, link inputs, table toolbar, etc.).
 *
 * Uses the `data-editor-container` attribute to find the correct container,
 * avoiding fragile `.closest('.relative')` queries.
 *
 * @param view - ProseMirror EditorView
 * @param pos - PM document position to anchor to
 * @returns `{ top, left }` relative to the editor container, or null if container not found
 */
export function getPositionRelativeToEditor(
  view: EditorView,
  pos: number,
): { top: number; left: number } | null {
  const container = view.dom.closest(EDITOR_CONTAINER_SELECTOR) as HTMLElement | null
  if (!container) return null

  const coords = view.coordsAtPos(pos)
  const containerRect = container.getBoundingClientRect()

  return {
    top: coords.bottom - containerRect.top + POPOVER_GAP_PX,
    left: coords.left - containerRect.left,
  }
}

/**
 * Computes a position from a DOM Range relative to the editor container.
 * Used when positioning from a text selection (e.g. comment icon click).
 */
export function getPositionFromRange(
  range: Range,
): { top: number; left: number } | null {
  const rect = range.getBoundingClientRect()
  const container = range.startContainer.parentElement?.closest(EDITOR_CONTAINER_SELECTOR) as HTMLElement | null
  if (!container) return null

  const containerRect = container.getBoundingClientRect()

  return {
    top: rect.bottom - containerRect.top + POPOVER_GAP_PX,
    left: rect.left - containerRect.left,
  }
}

/**
 * Get display name from comment data. Falls back to author ID if no name stored.
 */
export function getCommentDisplayName(comment: { authorFirstName: string | null; authorLastName: string | null; author: string }): string {
  return [comment.authorFirstName, comment.authorLastName].filter(Boolean).join(' ') || comment.author
}

/**
 * Get avatar initials (first char of firstName + first char of lastName).
 */
export function getCommentInitials(comment: { authorFirstName: string | null; authorLastName: string | null; author: string }): string {
  const first = comment.authorFirstName?.[0] ?? ''
  const last = comment.authorLastName?.[0] ?? ''
  return (first + last).toUpperCase() || comment.author[0]?.toUpperCase() || '?'
}

/**
 * Formats a timestamp as a relative time string.
 * Examples: "just now", "3m ago", "2h ago", "5d ago", "Mar 15"
 */
export function relativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  const date = new Date(timestamp)
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
