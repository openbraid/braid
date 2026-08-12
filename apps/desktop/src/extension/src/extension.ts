import * as vscode from 'vscode'
import WebSocket from 'ws'
import {
  createTerminalPanel,
  updatePanelWithTerminal,
  renamePanel,
  getActiveTerminalPanel,
  getPanelCount,
  setOnPanelCountChange,
  BraidTerminalSerializer
} from './terminal-panel'
import { registerThemeSync } from './theme-sync'

// ─── Port discovery via environment variable ────────────────────────────────
// Electron sets BRAID_TERMINAL_WS_PORT when spawning the VS Code server process.
// The extension host inherits all env vars.

function readTerminalPort(out: vscode.OutputChannel): number | null {
  const raw = process.env.BRAID_TERMINAL_WS_PORT
  out.appendLine(`[braid] BRAID_TERMINAL_WS_PORT=${raw ?? '(unset)'}`)
  if (!raw) return null
  const port = parseInt(raw, 10)
  if (isNaN(port)) {
    out.appendLine('[braid] could not parse port from env var')
    return null
  }
  return port
}

// ─── Resolve workspace CWD from VS Code workspace folders ──────────────────

function resolveDefaultCwd(): string {
  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath
  }
  return process.env.HOME ?? '/'
}

// ─── Status bar ──────────────────────────────────────────────────────────────

function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  item.command = 'braid.newTerminal'
  item.tooltip = 'New Braid Terminal'
  updateStatusBarItem(item, 0)
  item.show()
  return item
}

function updateStatusBarItem(item: vscode.StatusBarItem, count: number): void {
  if (count === 0) {
    item.text = '$(terminal) Braid'
  } else {
    item.text = `$(terminal) Braid (${count})`
  }
}

// ─── Activate ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const activateAt = Date.now()
  const out = vscode.window.createOutputChannel('Braid')
  const rawPort = readTerminalPort(out)

  if (!rawPort) {
    out.appendLine('[braid] no terminal port found — staying inactive')
    return
  }

  const expressPort: number = rawPort
  out.appendLine(`[braid] Express server port: ${expressPort}`)
  out.appendLine(`[braid] [t=0ms] activate() called`)

  // Status bar item
  const statusBar = createStatusBarItem()
  context.subscriptions.push(statusBar)

  setOnPanelCountChange((count) => {
    updateStatusBarItem(statusBar, count)
  })

  // Register WebviewPanelSerializer for tab persistence across VS Code reloads
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(
      'braidTerminal',
      new BraidTerminalSerializer(expressPort, out)
    )
  )

  // Bidirectional theme sync (VS Code ↔ Braid)
  registerThemeSync(context, expressPort, out)

  // ─── Control WebSocket — receives commands from the main process ──────────

  function getWorkspaceFolderPaths(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
  }

  let controlWs: WebSocket | null = null

  function connectControlWs(): void {
    const ws = new WebSocket(`ws://127.0.0.1:${expressPort}/control`)
    controlWs = ws

    ws.on('open', () => {
      out.appendLine('[braid] Control WebSocket connected')
      ws.send(JSON.stringify({ type: 'CONTROL.REGISTER', folders: getWorkspaceFolderPaths() }))
    })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'CONTROL.CREATE_TERMINAL') {
          out.appendLine(`[braid] Control: CREATE_TERMINAL${msg.command ? ' (with command)' : ''}`)
          doCreateTerminal(msg.command)
        }
      } catch (err) {
        out.appendLine(`[braid] Control WebSocket parse error: ${err}`)
      }
    })

    ws.on('close', () => {
      out.appendLine('[braid] Control WebSocket disconnected — reconnecting in 2s')
      setTimeout(connectControlWs, 2000)
    })

    ws.on('error', (err) => {
      out.appendLine(`[braid] Control WebSocket error: ${err.message}`)
    })
  }

  // Connect after a short delay to ensure express server is ready
  setTimeout(connectControlWs, 500)

  // Notify main process when VS Code workspace folders change (workspace switch)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const folders = getWorkspaceFolderPaths()
      out.appendLine(`[braid] Workspace folders changed: ${folders.length} folders`)
      if (controlWs && controlWs.readyState === WebSocket.OPEN) {
        controlWs.send(JSON.stringify({ type: 'CONTROL.WORKSPACE_READY', folders }))
      }
    })
  )

  // Helper: create a new terminal (shared by command, auto-create, and control WS)
  // If `command` is provided, writes it to the terminal after shell initialization.
  // If `cwd` is provided, uses it instead of the default workspace folder.
  async function doCreateTerminal(command?: string): Promise<void> {
    const t0 = Date.now()
    out.appendLine(`[braid] [t=${t0 - activateAt}ms] doCreateTerminal() start${command ? ' (with command)' : ''}`)

    // Generate the terminalId upfront so the panel can load immediately with the
    // correct URL — avoids a second iframe load after the HTTP response comes back.
    const terminalId = crypto.randomUUID()
    const panel = createTerminalPanel(context, expressPort, out, undefined, terminalId)
    out.appendLine(`[braid] [t=${Date.now() - activateAt}ms] panel created`)

    try {
      const cwd = resolveDefaultCwd()
      const fetchStart = Date.now()
      const response = await fetch(`http://127.0.0.1:${expressPort}/api/terminal/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, terminalId })
      })
      out.appendLine(`[braid] [t=${Date.now() - activateAt}ms] POST /api/terminal/create took ${Date.now() - fetchStart}ms`)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create terminal: ${errorText}`)
      }

      const data = (await response.json()) as {
        terminalId: string
        dbRecordId: string
        label: string
      }

      out.appendLine(`[braid] [t=${Date.now() - activateAt}ms] terminal ready: ${data.terminalId} (${data.label})`)

      updatePanelWithTerminal(panel, expressPort, {
        terminalId: data.terminalId,
        dbRecordId: data.dbRecordId,
        label: data.label
      })
      out.appendLine(`[braid] [t=${Date.now() - activateAt}ms] updatePanelWithTerminal done`)

      // If a command was requested (e.g. from Scratch "Launch with agent"),
      // write it to the terminal after a brief shell initialization delay
      if (command) {
        setTimeout(async () => {
          try {
            await fetch(`http://127.0.0.1:${expressPort}/api/terminal/write-input`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ terminalId: data.terminalId, data: command + '\r' })
            })
            out.appendLine(`[braid] Wrote launch command to terminal ${data.terminalId}`)
          } catch (err) {
            out.appendLine(`[braid] Failed to write launch command: ${err}`)
          }
        }, 400)
      }
    } catch (err) {
      out.appendLine(`[braid] Error creating terminal: ${err}`)
      vscode.window.showErrorMessage(
        `Failed to create terminal: ${err instanceof Error ? err.message : String(err)}`
      )
      panel.dispose()
    }
  }

  // Noop — suppresses VS Code's default Cmd+Shift+N ("New Window") which shows
  // a popup blocker error inside the embedded webview.
  context.subscriptions.push(
    vscode.commands.registerCommand('braid.noop', () => {})
  )

  // Command: Braid: New Terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('braid.newTerminal', doCreateTerminal)
  )

  // Command: Braid: Rename Terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('braid.renameTerminal', async () => {
      const active = getActiveTerminalPanel()
      if (!active) {
        vscode.window.showInformationMessage('No active terminal to rename')
        return
      }

      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new terminal name',
        placeHolder: 'Terminal 1',
        value: active.state.label
      })

      if (!newName || newName === active.state.label) return

      try {
        const response = await fetch(`http://127.0.0.1:${expressPort}/api/terminal/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dbRecordId: active.state.dbRecordId, label: newName })
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(errorText)
        }

        renamePanel(active.state.terminalId, newName)
        out.appendLine(`[braid] Terminal renamed: ${active.state.terminalId} → "${newName}"`)
      } catch (err) {
        out.appendLine(`[braid] Error renaming terminal: ${err}`)
        vscode.window.showErrorMessage(
          `Failed to rename terminal: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    })
  )

  // Command: Braid: Close Terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('braid.closeTerminal', async () => {
      const active = getActiveTerminalPanel()
      if (!active) {
        vscode.window.showInformationMessage('No active terminal to close')
        return
      }

      try {
        await fetch(`http://127.0.0.1:${expressPort}/api/terminal/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dbRecordId: active.state.dbRecordId })
        })
        out.appendLine(`[braid] Terminal closed: ${active.state.terminalId}`)
      } catch (err) {
        out.appendLine(`[braid] Error closing terminal: ${err}`)
      }

      active.panel.dispose()
    })
  )

  // Auto-create a terminal only if this workspace has no terminal records in DB.
  // This handles brand new workspaces. Existing workspaces get their panels
  // restored by the WebviewPanelSerializer instead.
  autoCreateIfNeeded(expressPort, out, doCreateTerminal, activateAt)
}

async function autoCreateIfNeeded(
  expressPort: number,
  out: vscode.OutputChannel,
  doCreateTerminal: () => Promise<void>,
  activateAt: number
): Promise<void> {
  const cwd = resolveDefaultCwd()
  const MAX_RETRIES = 8
  // Exponential backoff: 100 → 200 → 400 → 800 → 1600 → 3200 → 6000ms
  const retryDelays = [100, 200, 400, 800, 1600, 3200, 6000]

  const t0 = Date.now()
  out.appendLine(`[braid] [t=${t0 - activateAt}ms] autoCreateIfNeeded() start`)

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const fetchStart = Date.now()
      const response = await fetch(
        `http://127.0.0.1:${expressPort}/api/terminal/has-terminals?cwd=${encodeURIComponent(cwd)}`
      )
      out.appendLine(`[braid] [t=${Date.now() - activateAt}ms] has-terminals attempt ${attempt} took ${Date.now() - fetchStart}ms`)

      if (!response.ok) {
        const errorText = await response.text()
        out.appendLine(`[braid] has-terminals attempt ${attempt}/${MAX_RETRIES} failed: ${errorText}`)
      } else {
        const data = (await response.json()) as { hasTerminals: boolean }
        out.appendLine(`[braid] [t=${Date.now() - activateAt}ms] has-terminals=${data.hasTerminals} (attempt ${attempt})`)

        if (!data.hasTerminals) {
          await doCreateTerminal()
        }
        out.appendLine(`[braid] [t=${Date.now() - activateAt}ms] autoCreateIfNeeded() done (total ${Date.now() - t0}ms)`)
        return
      }
    } catch (err) {
      out.appendLine(`[braid] [t=${Date.now() - activateAt}ms] has-terminals attempt ${attempt}/${MAX_RETRIES} error: ${err}`)
    }

    if (attempt < MAX_RETRIES) {
      const delay = retryDelays[attempt - 1] ?? 6000
      out.appendLine(`[braid] retrying in ${delay}ms...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  out.appendLine(`[braid] has-terminals failed after all retries (total ${Date.now() - t0}ms) — skipping auto-create`)
}

export function deactivate(): void {
  // context.subscriptions handles all cleanup
}
