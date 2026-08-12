// Bidirectional theme sync between VS Code and Braid.
//
// VS Code → Braid: user changes theme via command palette
//   → onDidChangeActiveColorTheme → POST /api/theme/sync
//
// Braid → VS Code: theme changed in settings modal
//   → Express broadcasts THEME.CHANGED via WebSocket → extension applies it
//
// The WS subscription replaces the old 2s poll — purely event-driven.

import * as vscode from 'vscode'
import WebSocket from 'ws'

type ThemeKind = 'dark' | 'light'

function mapVscodeThemeKind(kind: vscode.ColorThemeKind): ThemeKind {
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark'
}

const VSCODE_THEME_MAP: Record<ThemeKind, string> = {
  dark: 'Default Dark Modern',
  light: 'Default Light Modern'
}

export function registerThemeSync(
  context: vscode.ExtensionContext,
  expressPort: number,
  out: vscode.OutputChannel
): void {
  // selfInitiated: we triggered the VS Code theme change — skip the echo back to Express
  let selfInitiated = false
  // vsCodeInitiated: VS Code triggered the change — skip applying it again when WS echoes it back
  let vsCodeInitiated = false

  // ── VS Code → Braid ──────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      if (selfInitiated) {
        selfInitiated = false
        return
      }

      const kind = mapVscodeThemeKind(theme.kind)
      out.appendLine(`[braid] VS Code theme changed to ${kind} — syncing to Braid`)

      // Mark before the async POST so the WS echo is suppressed when it arrives
      vsCodeInitiated = true

      fetch(`http://127.0.0.1:${expressPort}/api/theme/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind })
      }).catch((err) => {
        vsCodeInitiated = false
        out.appendLine(`[braid] Failed to sync theme to Braid: ${err}`)
      })
    })
  )

  // ── Braid → VS Code (WS subscription) ───────────────────────────────────

  let ws: WebSocket | null = null
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect(): void {
    if (disposed) return

    ws = new WebSocket(`ws://127.0.0.1:${expressPort}/ws`)

    ws.on('open', () => {
      out.appendLine('[braid] Theme sync WS connected')
    })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; kind?: ThemeKind }
        if (msg.type !== 'THEME.CHANGED' || !msg.kind) return

        if (vsCodeInitiated) {
          vsCodeInitiated = false
          return // this change came from VS Code — no need to set it again
        }

        const targetTheme = VSCODE_THEME_MAP[msg.kind]
        out.appendLine(`[braid] Braid theme changed to ${msg.kind} — setting VS Code to ${targetTheme}`)

        selfInitiated = true
        vscode.workspace.getConfiguration('workbench').update(
          'colorTheme',
          targetTheme,
          vscode.ConfigurationTarget.Global
        ).then(undefined, (err) => {
          selfInitiated = false
          out.appendLine(`[braid] Failed to update VS Code theme: ${err}`)
        })
      } catch {
        // malformed message
      }
    })

    ws.on('close', () => {
      ws = null
      if (!disposed) {
        reconnectTimer = setTimeout(connect, 3000)
      }
    })

    ws.on('error', () => {
      // 'close' fires after 'error' — reconnect happens there
    })
  }

  connect()

  context.subscriptions.push({
    dispose: () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  })
}
