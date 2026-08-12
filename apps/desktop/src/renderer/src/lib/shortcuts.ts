// ─── Shortcut wiring helpers ──────────────────────────────────────────────────
// Attaches/detaches keyboard listeners for chrome-context shortcuts.
// 'global' scope shortcuts are handled by Electron Menu accelerators in the
// main process (src/main/index.ts), which fire at the browser level regardless
// of focus context (chrome or webview).

import { SHORTCUTS } from '../../../shared/shortcuts'
import type { ShortcutId } from '../../../shared/shortcuts'

export type ShortcutHandler = (id: ShortcutId) => void

// ─── Chrome shortcuts ─────────────────────────────────────────────────────────
// Active only when the VS Code webview is NOT focused (standard document keydown).
// Handles 'chrome' scope shortcuts like ⌘⇧N (new workspace), Ctrl+Shift+O (list).

export function setupChromeShortcuts(handler: ShortcutHandler): () => void {
  const defs = SHORTCUTS.filter((s) => s.scope === 'chrome')

  function onKeyDown(e: KeyboardEvent) {
    for (const def of defs) {
      if (!def.matchKey) continue
      if (
        e.key.toLowerCase() === def.matchKey.toLowerCase() &&
        !!def.matchCtrl === e.ctrlKey &&
        !!def.matchShift === e.shiftKey &&
        !!def.matchMeta === e.metaKey
      ) {
        e.preventDefault()
        handler(def.id)
        return
      }
    }
  }

  document.addEventListener('keydown', onKeyDown)
  return () => document.removeEventListener('keydown', onKeyDown)
}
