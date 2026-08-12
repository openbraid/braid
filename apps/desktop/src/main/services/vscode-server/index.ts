import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import axios from 'axios'
import { allocatePort, releasePort } from '../../lib/port-manager'
import { deriveVscodeExtensionsDir, deriveVscodeSharedUserDataDir, deriveTerminalPortFilePath } from '../../lib/derive-paths'
import { Channels } from '../../../shared/ipc-types'
import { startTerminalServer, stopTerminalServer } from '../terminal'
import { getCurrentThemeKind } from '../theme'

// ─── Status ───────────────────────────────────────────────────────────────────

export const ServerStatus = {
  Starting: 'starting',
  Ready: 'ready',
  Crashed: 'crashed'
} as const

export type ServerStatus = (typeof ServerStatus)[keyof typeof ServerStatus]

// ─── Types ────────────────────────────────────────────────────────────────────

type ServerEntry = {
  projectId: string
  port: number
  terminalWsPort: number
  process: ChildProcess
  status: ServerStatus
  startPromise: Promise<void>
  workspaceFilePath: string
  intentionalShutdown: boolean
  crashCount: number
  firstCrashAt: number | null
  listeners: { event: string; handler: (...args: unknown[]) => void }[]
}

// ─── Singletons ───────────────────────────────────────────────────────────────

const serverMap = new Map<string, ServerEntry>()
let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getOrStartServer(
  projectId: string,
  workspaceFilePath: string
): Promise<number> {
  const entry = serverMap.get(projectId)

  if (entry) {
    if (entry.status === ServerStatus.Ready) return entry.port
    if (entry.status === ServerStatus.Starting) {
      await entry.startPromise
      return entry.port
    }
    if (entry.status === ServerStatus.Crashed) {
      throw new Error(
        'VS Code server for this project has crashed and cannot be restarted automatically'
      )
    }
  }

  return startServer(projectId, workspaceFilePath)
}

export async function stopServer(projectId: string): Promise<void> {
  const entry = serverMap.get(projectId)
  if (!entry) return

  entry.intentionalShutdown = true

  // Remove listeners to prevent leaks on restart cycles
  entry.process.stdout?.removeAllListeners('data')
  entry.process.stderr?.removeAllListeners('data')
  for (const { event, handler } of entry.listeners) {
    if (event === 'exit') entry.process.removeListener('exit', handler)
  }
  entry.listeners = []

  entry.process.kill('SIGTERM')

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      entry.process.kill('SIGKILL')
      resolve()
    }, 5000)

    entry.process.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })

  releasePort(entry.port)
  releasePort(entry.terminalWsPort)
  try { rmSync(deriveTerminalPortFilePath(entry.port)) } catch { /* already gone */ }
  await stopTerminalServer(projectId)
  serverMap.delete(projectId)
}

// Returns the terminal WebSocket port for a running server.
// Used by worktree service when regenerating the .code-workspace file.
export function getTerminalWsPort(projectId: string): number | null {
  return serverMap.get(projectId)?.terminalWsPort ?? null
}

export async function stopAllServers(): Promise<void> {
  await Promise.all([...serverMap.keys()].map(stopServer))
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function startServer(projectId: string, workspaceFilePath: string): Promise<number> {
  // In dev: resources/vscode-server lives inside the app source.
  // In production: extraResources copies it to Contents/Resources/vscode-server.
  const isPackaged = app.isPackaged
  const binaryPath = isPackaged
    ? path.join(process.resourcesPath, 'vscode-server', 'bin', 'code-server')
    : path.join(app.getAppPath(), 'resources', 'vscode-server', 'bin', 'code-server')

  if (!existsSync(binaryPath)) {
    const err = new Error(
      `VS Code server binary not found at: ${binaryPath}. Run: npm run setup:vscode-server`
    )
    ;(err as NodeJS.ErrnoException).code = 'VSCODE_BINARY_NOT_FOUND'
    throw err
  }

  const port = await allocatePort()
  const terminalWsPort = await allocatePort()

  const sharedUserDataDir = deriveVscodeSharedUserDataDir()
  const machineSettingsDir = path.join(sharedUserDataDir, 'data', 'Machine')
  mkdirSync(machineSettingsDir, { recursive: true })

  // Write default settings — only fill in keys not already set by the user
  const machineSettingsPath = path.join(machineSettingsDir, 'settings.json')
  const DEFAULTS: Record<string, unknown> = {
    'workbench.colorTheme': getCurrentThemeKind() === 'light' ? 'Default Light Modern' : 'Default Dark Modern',
    'telemetry.telemetryLevel': 'off',
    'security.workspace.trust.enabled': false,
    'editor.minimap.enabled': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'extensions.verifySignature': false,
    'extensions.ignoreRecommendations': true,
    '[yaml]': { 'editor.wordWrap': 'on' }
  }
  let existing: Record<string, unknown> = {}
  if (existsSync(machineSettingsPath)) {
    try { existing = JSON.parse(readFileSync(machineSettingsPath, 'utf-8')) } catch { /* ignore */ }
  }
  const merged = { ...DEFAULTS, ...existing }
  writeFileSync(machineSettingsPath, JSON.stringify(merged, null, 2))

  const extensionsDir = deriveVscodeExtensionsDir()
  mkdirSync(extensionsDir, { recursive: true })

  const child = spawn(
    binaryPath,
    [
      '--host', '127.0.0.1',
      '--port', String(port),
      '--server-data-dir', sharedUserDataDir,
      '--extensions-dir', extensionsDir,
      '--without-connection-token',
      '--accept-server-license-terms',
      '--disable-telemetry',
      '--disable-workspace-trust'
    ],
    {
      detached: false,
      stdio: 'pipe',
      env: { ...process.env, BRAID_TERMINAL_WS_PORT: String(terminalWsPort) }
    }
  )

  const entry: ServerEntry = {
    projectId,
    port,
    terminalWsPort,
    process: child,
    status: ServerStatus.Starting,
    startPromise: Promise.resolve(), // placeholder — replaced below
    workspaceFilePath,
    intentionalShutdown: false,
    crashCount: 0,
    firstCrashAt: null,
    listeners: []
  }

  serverMap.set(projectId, entry)

  const onStdout = (d: Buffer): void => { console.log(`[vscode-server][${projectId.slice(0,8)}] stdout:`, String(d).trimEnd()) }
  const onStderr = (d: Buffer): void => { console.error(`[vscode-server][${projectId.slice(0,8)}] stderr:`, String(d).trimEnd()) }
  const onExit = (code: number | null, signal: string | null): void => { console.log(`[vscode-server][${projectId.slice(0,8)}] exited code=${code} signal=${signal}`) }

  child.stdout?.on('data', onStdout)
  child.stderr?.on('data', onStderr)
  child.on('exit', onExit)

  entry.listeners = [
    { event: 'data', handler: onStdout as (...args: unknown[]) => void },
    { event: 'data', handler: onStderr as (...args: unknown[]) => void },
    { event: 'exit', handler: onExit as (...args: unknown[]) => void }
  ]

  // Start terminal WS server immediately — extension connects once VS Code loads
  startTerminalServer(projectId, terminalWsPort)

  const startPromise = new Promise<void>((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`http://127.0.0.1:${port}/`, { timeout: 400 })
        if (res.status === 200) {
          clearInterval(interval)
          clearTimeout(timeoutHandle)
          entry.status = ServerStatus.Ready
          const portFile = deriveTerminalPortFilePath(port)
          mkdirSync(path.dirname(portFile), { recursive: true })
          writeFileSync(portFile, JSON.stringify({ projectId, terminalWsPort }), 'utf-8')
          mainWindow?.webContents.send(Channels.VSCODE_SERVER_READY, { projectId, port })
          resolve()
        }
      } catch {
        // not ready yet — keep polling
      }
    }, 500)

    const timeoutHandle = setTimeout(() => {
      clearInterval(interval)
      const err = new Error(`VS Code server for project ${projectId} failed to start within 30s`)
      ;(err as NodeJS.ErrnoException).code = 'VSCODE_SERVER_TIMEOUT'
      handleCrash(projectId)
      reject(err)
    }, 30_000)
  })

  entry.startPromise = startPromise

  child.on('exit', (code) => {
    if (code !== 0 && !entry.intentionalShutdown) {
      handleCrash(projectId)
    }
  })

  await startPromise
  return port
}

function handleCrash(projectId: string): void {
  const entry = serverMap.get(projectId)
  if (!entry) return

  entry.status = ServerStatus.Crashed
  entry.crashCount++

  if (entry.firstCrashAt === null) {
    entry.firstCrashAt = Date.now()
  }

  const withinCrashWindow = Date.now() - entry.firstCrashAt < 60_000

  if (entry.crashCount >= 3 && withinCrashWindow) {
    mainWindow?.webContents.send(Channels.VSCODE_SERVER_CRASHED, { projectId })
    return
  }

  if (!withinCrashWindow) {
    entry.crashCount = 1
    entry.firstCrashAt = Date.now()
  }

  setTimeout(() => {
    startServer(projectId, entry.workspaceFilePath).catch(() => {
      // handleCrash will be called again via the exit handler if it fails
    })
  }, 2000)
}
