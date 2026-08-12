// Express HTTP + WebSocket server for embedded terminal I/O.
// One server per project. Serves the xterm.js SPA and handles terminal data via WebSocket.
// Replaces the old bare ws-server.ts.

import express from 'express'
import { createServer, type Server } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import path from 'path'
import { app as electronApp, shell } from 'electron'
import type { WsClientMessage, WsServerMessage, ControlServerMessage } from './types'
import { writeToTerminal, resizeTerminal } from './pty-manager'
import { resolveWorkspaceId } from './state-machine'
import { getActiveTerminalsByWorkspace } from '../../db/queries/workspace-terminals'
import type { WorkspaceTerminalEntry } from '../../../shared/ipc-types'
import { startRecording, stopRecording, isRecording } from '../dictation'
import { setThemeFromVsCode, getCurrentThemeKind, shouldSuppressVsCodeSync, setThemeWsBroadcast } from '../theme'
import type { ThemeKind } from '../../../shared/theme'

// ─── Injected handlers (set by index.ts to avoid circular imports) ───────────

type CreateTerminalFn = (workspaceId: string, terminalId?: string) => WorkspaceTerminalEntry
type KillTerminalFn = (dbRecordId: string) => void
type RespawnTerminalFn = (dbRecordId: string) => WorkspaceTerminalEntry | null
type RenameTerminalFn = (dbRecordId: string, label: string) => void

let _createTerminal: CreateTerminalFn | null = null
let _killTerminal: KillTerminalFn | null = null
let _respawnTerminal: RespawnTerminalFn | null = null
let _renameTerminal: RenameTerminalFn | null = null
let _onUserInput: ((terminalId: string, data: string) => void) | null = null

export function setApiHandlers(
  create: CreateTerminalFn,
  kill: KillTerminalFn,
  respawn: RespawnTerminalFn,
  rename: RenameTerminalFn
): void {
  _createTerminal = create
  _killTerminal = kill
  _respawnTerminal = respawn
  _renameTerminal = rename
}

export function setOnUserInput(cb: (terminalId: string, data: string) => void): void {
  _onUserInput = cb
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ServerEntry = {
  httpServer: Server
  wss: WebSocketServer
  controlWss: WebSocketServer
  port: number
}

// terminalId → Set<WebSocket> (one terminal can have multiple viewers)
type TerminalSockets = Map<string, Set<WebSocket>>

// ─── State ───────────────────────────────────────────────────────────────────

const servers = new Map<string, ServerEntry>()
const terminalClients: TerminalSockets = new Map()

// Control WebSocket — one connection per VS Code extension instance
let controlSocket: WebSocket | null = null
let _extensionFolders: string[] = []
let _onWorkspaceFoldersChanged: ((folders: string[]) => void) | null = null

export function setOnWorkspaceFoldersChanged(cb: (folders: string[]) => void): void {
  _onWorkspaceFoldersChanged = cb
}

export function getExtensionFolders(): string[] {
  return _extensionFolders
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function startExpressServer(projectId: string, port: number): void {
  if (servers.has(projectId)) return

  const app = express()
  app.use(express.json())

  // Serve embedded terminal SPA static files
  const embeddedTerminalPath = path.join(electronApp.getAppPath(), 'out', 'embedded-terminal')
  app.use('/terminal', express.static(embeddedTerminalPath))
  // SPA fallback — serve index.html for any /terminal/* route
  // Express 5 requires named wildcard parameters
  app.get('/terminal/*path', (_req, res) => {
    res.sendFile(path.join(embeddedTerminalPath, 'index.html'))
  })

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', projectId })
  })

  // API: check if workspace has any active terminal records in DB
  app.get('/api/terminal/has-terminals', (req, res) => {
    try {
      const cwd = req.query.cwd as string
      if (!cwd) {
        res.status(400).json({ error: 'Missing cwd query parameter' })
        return
      }
      const workspaceId = resolveWorkspaceId(cwd)
      if (!workspaceId) {
        // No workspace mapped yet — treat as "no terminals"
        res.json({ hasTerminals: false })
        return
      }
      const active = getActiveTerminalsByWorkspace(workspaceId)
      res.json({ hasTerminals: active.length > 0 })
    } catch (err) {
      console.error('[express-server] Failed to check terminals:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // API: create terminal (called by VS Code extension via HTTP)
  app.post('/api/terminal/create', (req, res) => {
    try {
      if (!_createTerminal) {
        res.status(503).json({ error: 'Terminal service not initialized' })
        return
      }
      const { cwd, terminalId } = req.body as { cwd: string; terminalId?: string }
      const workspaceId = resolveWorkspaceId(cwd)
      if (!workspaceId) {
        res.status(400).json({ error: `No workspace found for cwd: ${cwd}` })
        return
      }

      const entry = _createTerminal(workspaceId, terminalId)
      res.json({
        terminalId: entry.terminalId,
        dbRecordId: entry.id,
        label: entry.label
      })
    } catch (err) {
      console.error('[express-server] Failed to create terminal:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // API: close terminal (called by VS Code extension when panel is disposed)
  app.post('/api/terminal/close', (req, res) => {
    try {
      if (!_killTerminal) {
        res.status(503).json({ error: 'Terminal service not initialized' })
        return
      }
      const { dbRecordId } = req.body as { dbRecordId: string }
      _killTerminal(dbRecordId)
      res.json({ success: true })
    } catch (err) {
      console.error('[express-server] Failed to close terminal:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // API: respawn terminal (called by VS Code extension serializer on reload)
  // Creates a fresh PTY for an existing DB record.
  app.post('/api/terminal/respawn', (req, res) => {
    try {
      if (!_respawnTerminal) {
        res.status(503).json({ error: 'Terminal service not initialized' })
        return
      }
      const { dbRecordId } = req.body as { dbRecordId: string }
      const entry = _respawnTerminal(dbRecordId)
      if (!entry) {
        res.status(404).json({ error: 'Terminal record not found or workspace not open' })
        return
      }
      res.json({
        terminalId: entry.terminalId,
        dbRecordId: entry.id,
        label: entry.label
      })
    } catch (err) {
      console.error('[express-server] Failed to respawn terminal:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // API: rename terminal (called by VS Code extension)
  app.post('/api/terminal/rename', (req, res) => {
    try {
      if (!_renameTerminal) {
        res.status(503).json({ error: 'Terminal service not initialized' })
        return
      }
      const { dbRecordId, label } = req.body as { dbRecordId: string; label: string }
      _renameTerminal(dbRecordId, label)
      res.json({ success: true })
    } catch (err) {
      console.error('[express-server] Failed to rename terminal:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  // API: get current theme (called by VS Code extension on startup)
  app.get('/api/theme', (_req, res) => {
    res.json({ kind: getCurrentThemeKind(), suppressSync: shouldSuppressVsCodeSync() })
  })

  // API: sync theme from VS Code (called when user changes theme via command palette)
  app.post('/api/theme/sync', (req, res) => {
    const { kind } = req.body as { kind: ThemeKind }
    setThemeFromVsCode(kind)
    res.json({ success: true })
  })

  // API: open a URL in the system browser (used by embedded terminal for clickable links)
  app.post('/api/open-external', (req, res) => {
    const { url } = req.body as { url: string }
    if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
      res.status(400).json({ error: 'Invalid or missing url' })
      return
    }
    shell.openExternal(url).catch((err) => {
      console.error('[express-server] shell.openExternal failed:', err)
    })
    res.json({ success: true })
  })

  // API: write input to a terminal's PTY (used by extension after creating terminal with command)
  app.post('/api/terminal/write-input', (req, res) => {
    try {
      const { terminalId, data } = req.body as { terminalId: string; data: string }
      if (!terminalId || !data) {
        res.status(400).json({ error: 'Missing terminalId or data' })
        return
      }
      _onUserInput?.(terminalId, data)
      writeToTerminal(terminalId, data)
      res.json({ success: true })
    } catch (err) {
      console.error('[express-server] Failed to write terminal input:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  })

  const httpServer = createServer(app)

  // WebSocket servers — upgrade from HTTP, no separate port
  const wss = new WebSocketServer({ noServer: true })
  const controlWss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else if (url.pathname === '/control') {
      controlWss.handleUpgrade(request, socket, head, (ws) => {
        controlWss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  // Control WebSocket — extension connects here for server-pushed commands
  controlWss.on('connection', (ws: WebSocket) => {
    console.log(`[express-server] Control WebSocket connected (project ${projectId.slice(0, 8)})`)
    controlSocket = ws

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as import('./types').ControlClientMessage
        if (msg.type === 'CONTROL.REGISTER' || msg.type === 'CONTROL.WORKSPACE_READY') {
          _extensionFolders = msg.folders
          console.log(`[express-server] Extension folders updated (${msg.type}): ${msg.folders.length} folders`)
          _onWorkspaceFoldersChanged?.(msg.folders)
        }
      } catch { /* ignore parse errors */ }
    })

    ws.on('close', () => {
      if (controlSocket === ws) {
        controlSocket = null
        _extensionFolders = []
      }
      console.log(`[express-server] Control WebSocket disconnected`)
    })

    ws.on('error', () => {
      if (controlSocket === ws) {
        controlSocket = null
        _extensionFolders = []
      }
    })
  })

  wss.on('connection', (ws: WebSocket) => {
    console.log(`[express-server] WebSocket client connected (project ${projectId.slice(0, 8)})`)

    ws.on('message', (raw) => {
      let msg: WsClientMessage
      try {
        msg = JSON.parse(raw.toString()) as WsClientMessage
      } catch {
        return
      }
      handleClientMessage(ws, msg)
    })

    ws.on('close', () => {
      unregisterSocket(ws)
    })

    ws.on('error', () => {
      unregisterSocket(ws)
    })
  })

  httpServer.listen(port, '127.0.0.1', () => {
    console.log(`[express-server] Started on port ${port} for project ${projectId}`)
  })

  servers.set(projectId, { httpServer, wss, controlWss, port })

  // Register the WS broadcast for theme changes (sends to ALL connected clients)
  setThemeWsBroadcast((kind: ThemeKind) => {
    const msg = JSON.stringify({ type: 'THEME.CHANGED', kind })
    for (const [, entry] of servers) {
      entry.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg)
        }
      })
    }
  })
}

export function stopExpressServer(projectId: string): Promise<void> {
  const entry = servers.get(projectId)
  if (!entry) return Promise.resolve()

  return new Promise((resolve) => {
    // Close all WebSocket connections
    entry.wss.clients.forEach((ws) => ws.terminate())
    entry.controlWss.clients.forEach((ws) => ws.terminate())

    const timeout = setTimeout(() => {
      console.warn(`[express-server] Close timed out for project ${projectId}, forcing cleanup`)
      servers.delete(projectId)
      resolve()
    }, 5000)

    entry.httpServer.close(() => {
      clearTimeout(timeout)
      servers.delete(projectId)
      console.log(`[express-server] Stopped for project ${projectId}`)
      resolve()
    })
  })
}

export function stopAllExpressServers(): Promise<void> {
  return Promise.all([...servers.keys()].map(stopExpressServer)).then(() => {})
}

// ─── Control WebSocket — send commands to the VS Code extension ─────────────

export function isExtensionConnected(): boolean {
  return controlSocket !== null && controlSocket.readyState === WebSocket.OPEN
}

export function sendToExtension(message: ControlServerMessage): boolean {
  if (!controlSocket || controlSocket.readyState !== WebSocket.OPEN) {
    console.warn('[express-server] No control WebSocket connected — cannot send to extension')
    return false
  }
  controlSocket.send(JSON.stringify(message))
  return true
}

// ─── Broadcasting (called by index.ts when pty-manager emits data/exit) ─────

export function broadcastToTerminal(terminalId: string, message: WsServerMessage): void {
  const sockets = terminalClients.get(terminalId)
  if (!sockets) return

  const json = JSON.stringify(message)
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json)
    }
  }
}

// ─── Message handling ────────────────────────────────────────────────────────

function handleClientMessage(ws: WebSocket, msg: WsClientMessage): void {
  switch (msg.type) {
    case 'REGISTER': {
      registerSocket(msg.terminalId, ws)
      break
    }
    case 'TERMINAL.INPUT': {
      _onUserInput?.(msg.terminalId, msg.data)
      writeToTerminal(msg.terminalId, msg.data)
      break
    }
    case 'TERMINAL.RESIZE': {
      resizeTerminal(msg.terminalId, msg.cols, msg.rows)
      break
    }
    case 'DICTATION.START': {
      if (isRecording()) {
        sendToSocket(ws, { type: 'DICTATION.ERROR', error: 'Dictation is already active' })
        break
      }
      startRecording((response) => sendToSocket(ws, response as WsServerMessage))
      break
    }
    case 'DICTATION.STOP': {
      // Stop recording. Audio will be transcribed asynchronously —
      // DICTATION.RESULT or DICTATION.ERROR sent back when ready.
      stopRecording()
      break
    }
  }
}

function sendToSocket(ws: WebSocket, msg: WsServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function registerSocket(terminalId: string, ws: WebSocket): void {
  let sockets = terminalClients.get(terminalId)
  if (!sockets) {
    sockets = new Set()
    terminalClients.set(terminalId, sockets)
  }
  sockets.add(ws)
  console.log(`[express-server] Socket registered for terminal ${terminalId.slice(0, 8)}`)

  // Send current theme immediately so the SPA initialises with the correct colours
  sendToSocket(ws, { type: 'REGISTERED', themeKind: getCurrentThemeKind() })
}

function unregisterSocket(ws: WebSocket): void {
  for (const [terminalId, sockets] of terminalClients) {
    sockets.delete(ws)
    if (sockets.size === 0) {
      terminalClients.delete(terminalId)
    }
  }
}
