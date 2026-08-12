// ─── Shared Constants for Collaboration ──────────────────────────────────────

/**
 * Field names that are stored as Y.XmlFragment (rich text with PM nodes)
 * instead of Y.Text (plain string). Any field in this set gets:
 *   - Named top-level XmlFragment: doc.getXmlFragment('{arrayName}:{itemId}:{fieldName}')
 *   - Tiptap Collaboration-backed editor in Shared mode
 *   - Comment support with Yjs relative positions
 *   - Reconciliation via clear-and-rebuild with diff-based comment re-anchoring
 *
 * Adding a new rich-text field = add one string here. No other code change.
 */
export const RICH_TEXT_FIELDS = new Set(['description', 'context']);

/**
 * Build the Y.XmlFragment name for a rich-text field inside an array item.
 * Example: fragmentName('requirements', 'REQ-001', 'description')
 *        → 'requirements:REQ-001:description'
 */
export function fragmentName(arrayName: string, itemId: string, fieldName: string): string {
  return `${arrayName}:${itemId}:${fieldName}`;
}
