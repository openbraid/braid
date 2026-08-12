// Theme service — stores active theme, persists to app-state, broadcasts changes.
//
// Theme can be changed from:
//   1. Settings modal in the Electron renderer (via IPC → APP_STATE_SET)
//   2. VS Code command palette (via extension → Express API → this service)
//
// On change, this service:
//   - Persists to app-state (survives restart)
//   - Pushes THEME_CHANGED to Electron renderer (CSS variable swap)
//   - Broadcasts via WebSocket to all terminal SPAs (xterm + dictation recolor)

import { BrowserWindow } from 'electron'
import { Channels } from '../../../shared/ipc-types'
import type { ThemeKind } from '../../../shared/theme'
import { getAppState, setAppState } from '../../lib/app-state'

// ─── State ──────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let wsBroadcast: ((kind: ThemeKind) => void) | null = null

// Track whether the current change was initiated by VS Code (to prevent loop)
let suppressVsCodeSync = false

export function setThemeMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function setThemeWsBroadcast(broadcast: (kind: ThemeKind) => void): void {
  wsBroadcast = broadcast
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getCurrentThemeKind(): ThemeKind {
  return getAppState().themeKind ?? 'dark'
}

/**
 * Broadcast theme change to all layers.
 * Does NOT persist — caller is responsible for persistence.
 * Always broadcasts, no dedup guard (caller should check if change is needed).
 */
export function broadcastThemeChange(kind: ThemeKind, source: 'app' | 'vscode'): void {
  console.log(`[theme] Broadcasting theme '${kind}' (source: ${source}, wsBroadcast=${!!wsBroadcast})`)

  // Push to Electron renderer
  mainWindow?.webContents.send(Channels.THEME_CHANGED, { kind })

  // Broadcast to all terminal SPAs via WebSocket
  wsBroadcast?.(kind)

  // If change came from VS Code, suppress the echo back
  suppressVsCodeSync = source === 'vscode'
}

/**
 * Set theme from VS Code sync endpoint.
 * Persists + broadcasts (the Express endpoint is the only caller).
 */
export function setThemeFromVsCode(kind: ThemeKind): void {
  const current = getCurrentThemeKind()
  if (kind === current) return

  setAppState({ themeKind: kind })
  broadcastThemeChange(kind, 'vscode')
}

export function shouldSuppressVsCodeSync(): boolean {
  const val = suppressVsCodeSync
  suppressVsCodeSync = false
  return val
}
