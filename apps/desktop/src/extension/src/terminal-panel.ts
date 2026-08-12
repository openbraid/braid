import * as vscode from 'vscode'

// ─── State persisted via vscode.setState for WebviewPanelSerializer ──────────

export type TerminalPanelState = {
  terminalId: string
  dbRecordId: string
  label: string
}

// ─── Tracked panels (for rename updates) ─────────────────────────────────────

type PanelWithTracking = vscode.WebviewPanel & {
  __setTerminalId?: (id: string) => void
}

const panels = new Map<string, vscode.WebviewPanel>()
const panelStates = new Map<vscode.WebviewPanel, TerminalPanelState>()

export function getPanel(terminalId: string): vscode.WebviewPanel | undefined {
  return panels.get(terminalId)
}

export function getPanelState(panel: vscode.WebviewPanel): TerminalPanelState | undefined {
  return panelStates.get(panel)
}

export function getActiveTerminalPanel(): { panel: vscode.WebviewPanel; state: TerminalPanelState } | undefined {
  for (const [, panel] of panels) {
    if (panel.active) {
      const state = panelStates.get(panel)
      if (state) return { panel, state }
    }
  }
  return undefined
}

export function getPanelCount(): number {
  return panels.size
}

// ─── Panel change callback (for status bar updates) ──────────────────────────

let onPanelCountChange: ((count: number) => void) | null = null

export function setOnPanelCountChange(cb: (count: number) => void): void {
  onPanelCountChange = cb
}

// ─── Shared message handler for all terminal panels ─────────────────────────
// Handles clipboard, focus, keyboard shortcut forwarding, and terminal exit.
// Must be registered on every panel — both newly created and deserialized.

function registerPanelMessageHandler(
  panel: vscode.WebviewPanel,
  out: vscode.OutputChannel
): void {
  panel.webview.onDidReceiveMessage(
    (msg: { type: string; command?: string; text?: string; exitCode?: number }) => {
      if (msg.type === 'clipboard-write' && msg.text) {
        vscode.env.clipboard.writeText(msg.text)
      }
      if (msg.type === 'clipboard-read') {
        vscode.env.clipboard.readText().then((text) => {
          panel.webview.postMessage({ type: 'clipboard-result', text })
        })
      }
      if (msg.type === 'terminal-ready') {
        panel.webview.postMessage({ type: 'focus-terminal' })
      }
      if (msg.type === 'extension-command' && msg.command) {
        vscode.commands.executeCommand(msg.command)
      }
      if (msg.type === 'terminal-exited') {
        out.appendLine(`[braid] Shell exited (code=${msg.exitCode}), closing panel`)
        panel.dispose()
      }
    }
  )
}

// ─── Create a new terminal WebviewPanel ──────────────────────────────────────

export function createTerminalPanel(
  context: vscode.ExtensionContext,
  expressPort: number,
  out: vscode.OutputChannel,
  state?: TerminalPanelState,
  terminalId?: string  // pre-generated ID for new terminals — avoids double iframe load
): vscode.WebviewPanel {
  const label = state?.label ?? 'New Terminal'
  const id = state?.terminalId ?? terminalId ?? 'pending'

  const panel = vscode.window.createWebviewPanel(
    'braidTerminal',
    label,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  )

  const terminalUrl = `http://127.0.0.1:${expressPort}/terminal/?terminalId=${id}`
  panel.webview.html = buildWebviewHtml(terminalUrl, state ?? null)

  if (state?.terminalId) {
    panels.set(state.terminalId, panel)
    panelStates.set(panel, state)
  } else if (terminalId) {
    // Register early so updatePanelWithTerminal can detect the URL hasn't changed.
    // panelStates is not set yet — dbRecordId is unknown until the HTTP response.
    panels.set(terminalId, panel)
  }

  // Use mutable ref so dispose always cleans up the correct terminalId,
  // even if updatePanelWithTerminal replaced it after creation.
  let currentTerminalId = state?.terminalId ?? terminalId ?? null

  // Expose a way for updatePanelWithTerminal to update the tracked ID
  ;(panel as PanelWithTracking).__setTerminalId = (id: string) => {
    currentTerminalId = id
  }

  panel.onDidDispose(() => {
    // Kill PTY + remove state-machine entry so the pill disappears
    const panelState = panelStates.get(panel)
    if (panelState?.dbRecordId) {
      fetch(`http://127.0.0.1:${expressPort}/api/terminal/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dbRecordId: panelState.dbRecordId })
      }).catch((err) => {
        out.appendLine(`[braid] Failed to close terminal on dispose: ${err}`)
      })
    }

    if (currentTerminalId) {
      panels.delete(currentTerminalId)
    }
    panelStates.delete(panel)
    onPanelCountChange?.(panels.size)
    out.appendLine(`[braid] Terminal panel disposed: ${currentTerminalId ?? 'pending'}`)
  })

  registerPanelMessageHandler(panel, out)

  // Auto-focus the terminal when its panel becomes visible/active again
  // (e.g. after switching workspaces or tabbing back to this panel)
  panel.onDidChangeViewState((e) => {
    if (e.webviewPanel.active) {
      panel.webview.postMessage({ type: 'focus-terminal' })
    }
  })

  onPanelCountChange?.(panels.size)
  context.subscriptions.push(panel)
  return panel
}

// ─── Update panel for a newly created terminal ───────────────────────────────
// Called after the main process creates the PTY and returns the IDs.

export function updatePanelWithTerminal(
  panel: vscode.WebviewPanel,
  expressPort: number,
  state: TerminalPanelState
): void {
  panel.title = state.label

  // If the panel is already showing this terminalId (pre-generated upfront),
  // skip the HTML rebuild — it would reload the iframe unnecessarily.
  // Instead, send a message so the webview updates its persisted vscode state.
  if (panels.get(state.terminalId) === panel) {
    panel.webview.postMessage({ type: 'update-state', state })
  } else {
    const terminalUrl = `http://127.0.0.1:${expressPort}/terminal/?terminalId=${state.terminalId}`
    panel.webview.html = buildWebviewHtml(terminalUrl, state)
  }

  panels.set(state.terminalId, panel)
  panelStates.set(panel, state)
  // Update the mutable terminalId so onDidDispose cleans up correctly
  ;(panel as PanelWithTracking).__setTerminalId?.(state.terminalId)
  onPanelCountChange?.(panels.size)
}

// ─── Rename a terminal panel ─────────────────────────────────────────────────

export function renamePanel(terminalId: string, label: string): void {
  const panel = panels.get(terminalId)
  if (panel) {
    panel.title = label
    const existing = panelStates.get(panel)
    if (existing) {
      panelStates.set(panel, { ...existing, label })
    }
  }
}

// ─── WebviewPanelSerializer ─────────────────────────────────────────────────
// Restores terminal panels when VS Code reloads.

export class BraidTerminalSerializer implements vscode.WebviewPanelSerializer {
  constructor(
    private readonly expressPort: number,
    private readonly out: vscode.OutputChannel
  ) {}

  async deserializeWebviewPanel(
    panel: vscode.WebviewPanel,
    state: TerminalPanelState | null
  ): Promise<void> {
    this.out.appendLine(`[braid] Deserializing panel: ${JSON.stringify(state)}`)

    if (!state?.dbRecordId) {
      this.out.appendLine('[braid] Invalid state (no dbRecordId), disposing panel')
      panel.dispose()
      return
    }

    // Respawn: ask main process for a fresh PTY for this DB record.
    // The old PTY is dead (app restarted), so we need a new one.
    // Retry a few times — the Express server or worktree paths may not be ready yet.
    const MAX_RETRIES = 5
    const RETRY_DELAY_MS = 2000

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.expressPort}/api/terminal/respawn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dbRecordId: state.dbRecordId })
        })

        if (response.ok) {
          const data = (await response.json()) as {
            terminalId: string
            dbRecordId: string
            label: string
          }

          this.out.appendLine(`[braid] Respawned terminal: ${data.terminalId} (${data.label}) on attempt ${attempt}`)

          const newState: TerminalPanelState = {
            terminalId: data.terminalId,
            dbRecordId: data.dbRecordId,
            label: data.label
          }

          const terminalUrl = `http://127.0.0.1:${this.expressPort}/terminal/?terminalId=${data.terminalId}`
          panel.webview.html = buildWebviewHtml(terminalUrl, newState)
          panel.title = data.label
          panels.set(data.terminalId, panel)
          panelStates.set(panel, newState)
          onPanelCountChange?.(panels.size)

          registerPanelMessageHandler(panel, this.out)

          // Auto-focus terminal when panel becomes active again
          panel.onDidChangeViewState((e) => {
            if (e.webviewPanel.active) {
              panel.webview.postMessage({ type: 'focus-terminal' })
            }
          })

          panel.onDidDispose(() => {
            // Kill PTY + remove state-machine entry so the pill disappears
            if (newState.dbRecordId) {
              fetch(`http://127.0.0.1:${this.expressPort}/api/terminal/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dbRecordId: newState.dbRecordId })
              }).catch((err) => {
                this.out.appendLine(`[braid] Failed to close terminal on dispose: ${err}`)
              })
            }

            panels.delete(data.terminalId)
            panelStates.delete(panel)
            onPanelCountChange?.(panels.size)
          })
          return // success
        }

        const errorText = await response.text()
        this.out.appendLine(`[braid] Respawn attempt ${attempt}/${MAX_RETRIES} failed: ${errorText}`)
      } catch (err) {
        this.out.appendLine(`[braid] Respawn attempt ${attempt}/${MAX_RETRIES} error: ${err}`)
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }

    this.out.appendLine('[braid] Respawn failed after all retries, disposing panel')
    panel.dispose()
  }
}

// ─── HTML builder ───────────────────────────────────────────────────────────

function buildWebviewHtml(terminalUrl: string, state: TerminalPanelState | null): string {
  const stateJson = state ? JSON.stringify(state) : 'null'

  return `<!DOCTYPE html>
<html style="height:100%;margin:0">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: #141414; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe id="terminal-iframe" src="${terminalUrl}"></iframe>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const iframe = document.getElementById('terminal-iframe');
      const state = ${stateJson};
      if (state) vscode.setState(state);

      // Forward focus requests to the iframe
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.type === 'focus-terminal' && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'focus-terminal' }, '*');
          iframe.focus();
        }
        // Forward clipboard requests from iframe to extension
        if (data && (data.type === 'clipboard-read' || data.type === 'clipboard-write')) {
          vscode.postMessage(data);
        }
        // Forward terminal-ready from iframe to extension
        if (data && data.type === 'terminal-ready') {
          vscode.postMessage(data);
        }
        // Forward extension commands from iframe → extension host
        if (data && data.type === 'extension-command') {
          vscode.postMessage(data);
        }
        // Forward terminal exit from iframe → extension host
        if (data && data.type === 'terminal-exited') {
          vscode.postMessage(data);
        }
        // Update persisted state after PTY is assigned (no iframe reload needed)
        if (data && data.type === 'update-state') {
          vscode.setState(data.state);
        }
        // Re-dispatch keyboard events from iframe so VS Code keybindings fire.
        // The iframe is a separate browsing context — key events don't bubble up.
        // We re-create the KeyboardEvent on the webview's document, which
        // VS Code's keybinding service listens on.
        if (data && data.type === 'forward-keydown') {
          const keyEvent = new KeyboardEvent('keydown', {
            key: data.key,
            code: data.code,
            ctrlKey: data.ctrlKey,
            shiftKey: data.shiftKey,
            altKey: data.altKey,
            metaKey: data.metaKey,
            bubbles: true,
            cancelable: true
          });
          document.dispatchEvent(keyEvent);
        }
      });
    })();
  </script>
</body>
</html>`
}
