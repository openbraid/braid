// ─── Single source of truth for all Braid keyboard shortcuts ────────────────
//
// scope:
//   'global'    — intercepted before VS Code webview via before-input-event
//   'chrome'    — works when VS Code is not focused (document keydown)
//   'extension' — handled by VS Code extension keybindings; listed here for docs only

export type ShortcutId =
  | 'workspace.next-tab'
  | 'workspace.prev-tab'
  | 'workspace.close'
  | 'workspace.new'
  | 'workspace.list'
  | 'scratch.toggle'
  | 'terminal.new'
  | 'terminal.dictation'
  | 'terminal.rename'

export type ShortcutScope = 'global' | 'chrome' | 'extension'
export type ShortcutCategory = 'workspace' | 'scratch' | 'terminal'

export type ShortcutDef = {
  id: ShortcutId
  category: ShortcutCategory
  label: string
  /** Display tokens rendered as key badges, e.g. ['⌘', '⇧', 'N'] */
  keys: string[]
  scope: ShortcutScope
  /** Optional note shown beneath category header or label */
  note?: string
  // ── Matching (only for 'global' and 'chrome' scope) ──────────────────────
  /** event.key value to match (case-insensitive) */
  matchKey?: string
  matchCtrl?: boolean
  matchShift?: boolean
  matchMeta?: boolean   // Cmd on macOS
}

export const SHORTCUT_CATEGORIES: { id: ShortcutCategory; label: string }[] = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'scratch',   label: 'Scratch' },
  { id: 'terminal',  label: 'Braid Terminal' }
]

export const SHORTCUTS: ShortcutDef[] = [
  // ── Workspace ─────────────────────────────────────────────────────────────
  {
    id: 'workspace.next-tab',
    category: 'workspace',
    label: 'Next workspace tab',
    keys: ['Ctrl', '⇧', '>'],
    scope: 'global',
    matchKey: '.',
    matchCtrl: true,
    matchShift: true
  },
  {
    id: 'workspace.prev-tab',
    category: 'workspace',
    label: 'Previous workspace tab',
    keys: ['Ctrl', '⇧', '<'],
    scope: 'global',
    matchKey: ',',
    matchCtrl: true,
    matchShift: true
  },
  {
    id: 'workspace.close',
    category: 'workspace',
    label: 'Close current workspace',
    keys: ['Ctrl', '⇧', 'W'],
    scope: 'global',
    matchKey: 'w',
    matchCtrl: true,
    matchShift: true
  },
  {
    id: 'workspace.new',
    category: 'workspace',
    label: 'New workspace',
    keys: ['Ctrl', '⇧', 'N'],
    scope: 'chrome',
    matchKey: 'n',
    matchCtrl: true,
    matchShift: true
  },
  {
    id: 'workspace.list',
    category: 'workspace',
    label: 'Open workspace list',
    keys: ['Ctrl', '⇧', 'O'],
    scope: 'chrome',
    matchKey: 'o',
    matchCtrl: true,
    matchShift: true
  },
  // ── Scratch ───────────────────────────────────────────────────────────────
  {
    id: 'scratch.toggle',
    category: 'scratch',
    label: 'Toggle Scratch panel',
    keys: ['Ctrl', '⇧', 'S'],
    scope: 'global',
    matchKey: 's',
    matchCtrl: true,
    matchShift: true
  },
  // ── Braid Terminal ───────────────────────────────────────────────────────
  {
    id: 'terminal.new',
    category: 'terminal',
    label: 'New terminal',
    keys: ['⌘', 'T'],
    scope: 'extension',
    note: 'When Braid terminal is active'
  },
  {
    id: 'terminal.dictation',
    category: 'terminal',
    label: 'Start dictation',
    keys: ['⌘', 'D'],
    scope: 'extension',
    note: 'When Braid terminal is active'
  },
  {
    id: 'terminal.rename',
    category: 'terminal',
    label: 'Rename terminal',
    keys: ['F2'],
    scope: 'extension',
    note: 'When Braid terminal is active'
  }
]
