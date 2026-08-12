// Public API for the terminal service.
// This is the only file other services import from.
// Wires PtyManager + FgMonitor + StateMachine + ExpressServer together.
// No business logic here — pure orchestration.

import { BrowserWindow } from 'electron'
import { Channels } from '../../../shared/ipc-types'
import type { WorkspaceTerminalEntry } from '../../../shared/ipc-types'

import {
  setOnData as ptySetOnData,
  setOnExit as ptySetOnExit,
  spawnTerminal as ptySpawn,
  killTerminal as ptyKill,
  killAll as ptyKillAll,
  writeToTerminal as ptyWrite
} from './pty-manager'

import { parseCommandCompleted, stripShellIntegration } from './shell-integration'
import { getAppState } from '../../lib/app-state'

import {
  setOnStateChange,
  handleTerminalSpawned,
  handleTerminalExited,
  handleCommandDetected,
  handleFgReturnedToShell,
  handleOutputActivity,
  handleTerminalRenamed,
  handleTerminalRemoved,
  getWorkspaceTerminals,
  handleWorkspaceVisited,
  clearWorkspaceTerminals,
  registerWorktreePath,
  unregisterWorktreePaths,
  worktreePathToWorkspaceId,
  terminalStore,
  matchMonitoredCommand,
  resolveWorkspaceId,
  setCustomMonitoredCommands,
  clearAllTerminalState
} from './state-machine'

import {
  startExpressServer,
  stopExpressServer,
  stopAllExpressServers,
  broadcastToTerminal,
  sendToExtension,
  isExtensionConnected,
  getExtensionFolders,
  setApiHandlers,
  setOnUserInput,
  setOnWorkspaceFoldersChanged
} from './express-server'

import {
  createTerminalRecord,
  getActiveTerminalsByWorkspace,
  getTerminalById,
  updateTerminalLabel,
  updateTerminalPtyId,
  deleteTerminalRecord
} from '../../db/queries/workspace-terminals'

// ─── Main window ref for IPC push ───────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

// ─── Custom monitored commands ────────────────────────────────────────────

import { projectRepo } from '../../repositories'

/**
 * Reload custom per-project monitored commands into the state machine.
 *
 * Goes through projectRepo, so this reads SQLite in local mode and the server
 * in team mode. Fire-and-forget: terminal monitoring falls back to the built-in
 * agent list if it fails, which is a degraded but working state.
 */
export function refreshProjectMonitoredCommands(): void {
  void (async () => {
    try {
      const projects = await projectRepo.getAll()
      const flat: string[] = []

      for (const project of projects) {
        try {
          flat.push(...(await projectRepo.getMonitoredCommands(project.id)))
        } catch {
          // One unreadable project must not drop the commands of the others.
        }
      }

      setCustomMonitoredCommands(flat)
    } catch (err) {
      console.warn(
        '[terminal] Failed to refresh monitored commands:',
        err instanceof Error ? err.message : err
      )
    }
  })()
}

// NOTE: Do NOT call refreshProjectMonitoredCommands() here at module load.
// It requires a valid JWT. The main process calls it after auth succeeds.

// ─── Wire state change → IPC push ──────────────────────────────────────────

setOnStateChange((workspaceId: string) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const terminals = getWorkspaceTerminals(workspaceId)
  mainWindow.webContents.send(Channels.TERMINAL_UPDATED, { workspaceId, terminals })
})

// ─── Input buffer + command detection ───────────────────────────────────────
// Accumulates keystrokes per terminal. On Enter (\r), checks if the typed
// command is in the monitored list and notifies the state machine.

const inputBuffers = new Map<string, string>()
const lastInputAt = new Map<string, number>()
const ECHO_SUPPRESS_MS = 500

// Exported for unit tests — the private-marker handling below is subtle enough
// that it needs direct coverage.
export function stripAnsiSequences(data: string): string {
  // CSI: ESC [ , optional private-marker (? < > =), params, intermediates, final byte.
  // The private-marker branch matters: terminals answer queries with sequences
  // like ESC[?36;3R (cursor position) and ESC[<35;20;14M (SGR mouse). Without
  // it those land in the command buffer as garbage and command matching fails.
  // SS3: ESC O <letter>.  Bare: ESC <letter>.
  // eslint-disable-next-line no-control-regex
  return data.replace(/\x1b(?:\[[?<>=]?[0-9;:]*[ -/]*[@-~]|O[A-Za-z]|[A-Za-z])/g, '')
}

function handleUserInput(terminalId: string, data: string): void {
  // Strip ANSI escape sequences before processing
  const cleanData = stripAnsiSequences(data)

  // Echo suppression must only be triggered by a HUMAN keystroke.
  //
  // Interactive TUI agents poll the terminal — cursor-position reports, mouse
  // tracking — and the emulator's replies arrive on this same input path many
  // times a second. Treating those as typing keeps the suppression window
  // permanently open, so real agent output is never counted as activity and the
  // status pill sits at idle while the agent is plainly working.
  //
  // After stripping, machine replies are empty; anything left is real input.
  if (cleanData.length > 0) {
    lastInputAt.set(terminalId, Date.now())
  }

  // Accumulate input
  let buffer = inputBuffers.get(terminalId) ?? ''

  for (const char of cleanData) {
    if (char === '\r' || char === '\n') {
      // Enter pressed — check if this is a monitored command
      const command = buffer.trim()
      if (command) {
        const match = matchMonitoredCommand(command)
        const entryExists = terminalStore.has(terminalId)
        console.log(
          `[terminal] Enter pressed: command="${command}", match=${match ? match.command : 'null'}, entryExists=${entryExists}, terminalId=${terminalId.slice(0, 8)}`
        )
        if (match) {
          handleCommandDetected(terminalId, match.command, match.isInteractive)
          // Notify terminal SPA about interactive agent status (for dictation gating)
          if (match.isInteractive) {
            broadcastToTerminal(terminalId, {
              type: 'TERMINAL.AGENT_STATUS',
              terminalId,
              isInteractiveAgent: true,
              command: match.command
            })
          }
        }
      }
      buffer = ''
    } else if (char === '\x7f' || char === '\b') {
      // Backspace — remove last char
      buffer = buffer.slice(0, -1)
    } else if (char === '\x03') {
      // Ctrl+C — clear buffer
      buffer = ''
    } else if (char === '\x15') {
      // Ctrl+U — clear line
      buffer = ''
    } else if (char >= ' ' || char === '\t') {
      // Printable character or tab
      buffer += char
    }
    // Ignore other control characters
  }

  inputBuffers.set(terminalId, buffer)
}

// ─── Wire PtyManager → StateMachine + ExpressServer ─────────────────────────

// Debug counters — see BRAID_DEBUG_TERMINAL in state-machine.ts.
const DEBUG_TERMINAL = process.env.BRAID_DEBUG_TERMINAL === '1'
const dataCounts = new Map<string, { chunks: number; bytes: number; suppressed: number; escapeOnly: number; meaningfulBytes: number }>()

if (DEBUG_TERMINAL) {
  setInterval(() => {
    for (const [id, c] of dataCounts) {
      console.log(
        `[term-dbg] pty-data ${id.slice(0, 8)} chunks=${c.chunks} rawBytes=${c.bytes} textBytes=${c.meaningfulBytes} escapeOnlyChunks=${c.escapeOnly} echoSuppressed=${c.suppressed} (last 2s)`
      )
    }
    dataCounts.clear()
  }, 2000).unref()
}

ptySetOnData((terminalId: string, data: string) => {
  if (DEBUG_TERMINAL) {
    const c = dataCounts.get(terminalId) ?? {
      chunks: 0,
      bytes: 0,
      suppressed: 0,
      escapeOnly: 0,
      meaningfulBytes: 0
    }
    c.chunks++
    c.bytes += data.length
    dataCounts.set(terminalId, c)
  }

  // 1. Check for OSC 633;D (command completed signal from shell integration)
  const exitCode = parseCommandCompleted(data)
  if (exitCode !== null) {
    if (DEBUG_TERMINAL) {
      console.log(`[term-dbg] OSC633;D seen on ${terminalId.slice(0, 8)} exit=${exitCode}`)
    }
    handleFgReturnedToShell(terminalId, getAppState().lastActiveWorkspaceId)
    // Notify terminal SPA that interactive agent has finished
    broadcastToTerminal(terminalId, {
      type: 'TERMINAL.AGENT_STATUS',
      terminalId,
      isInteractiveAgent: false,
      command: null
    })
  }

  // 2. Strip OSC 633 sequences before displaying to user
  const cleanData = stripShellIntegration(data)
  if (cleanData) {
    broadcastToTerminal(terminalId, { type: 'TERMINAL.DATA', terminalId, data: cleanData })
  }

  // 3. Report activity, but only for output that carries real content.
  //
  // Interactive TUI agents keep the terminal busy even when they are sitting
  // idle at their prompt: cursor-position queries, cursor repositioning, mouse
  // tracking. That traffic is continuous, so "any output means working" marks
  // such an agent as running forever. Stripping escape sequences leaves nothing
  // behind for housekeeping and leaves text behind for real work — a spinner
  // frame, a token count, streamed output.
  //
  // Echo suppression still applies on top: output within 500ms of a keystroke
  // is the terminal echoing what was just typed, not the agent doing anything.
  const meaningful = stripAnsiSequences(data).trim().length > 0
  const inputTs = lastInputAt.get(terminalId)
  const echoing = inputTs !== undefined && Date.now() - inputTs <= ECHO_SUPPRESS_MS

  if (DEBUG_TERMINAL) {
    const c = dataCounts.get(terminalId)
    if (c) {
      if (!meaningful) c.escapeOnly++
      if (echoing) c.suppressed++
      c.meaningfulBytes += meaningful ? stripAnsiSequences(data).trim().length : 0
    }
  }

  if (meaningful && !echoing) {
    handleOutputActivity(terminalId)
  }
})

ptySetOnExit((terminalId: string, exitCode: number) => {
  // 1. Broadcast exit to xterm.js clients
  broadcastToTerminal(terminalId, { type: 'TERMINAL.EXIT', terminalId, exitCode })

  // 2. Cleanup input buffer
  inputBuffers.delete(terminalId)
  lastInputAt.delete(terminalId)

  // 4. Update state machine
  handleTerminalExited(terminalId, exitCode, getAppState().lastActiveWorkspaceId)

  // 6. DB record intentionally left active — on next app launch, the
  //    serializer will respawn a fresh PTY for this record.
  //    Only manual close (killTerminalById) deletes the record.
})

// ─── Express server lifecycle ───────────────────────────────────────────────

export function startTerminalServer(projectId: string, port: number): void {
  startExpressServer(projectId, port)
}

export function stopTerminalServer(projectId: string): Promise<void> {
  return stopExpressServer(projectId)
}

export function stopAllTerminalServers(): Promise<void> {
  ptyKillAll()
  return stopAllExpressServers()
}

export function clearAllState(): void {
  inputBuffers.clear()
  lastInputAt.clear()
  clearAllTerminalState()
}

// ─── Worktree path registry ─────────────────────────────────────────────────
// Called by workspace service when worktrees are created/opened.

export function registerWorktree(worktreePath: string, workspaceId: string): void {
  registerWorktreePath(worktreePath, workspaceId)
}

export function unregisterWorkspace(workspaceId: string): void {
  // Kill all PTYs, stop fg monitoring, clean up input buffers.
  // DB records are kept so terminals can be restored if the workspace is reopened.
  for (const [terminalId, entry] of terminalStore) {
    if (entry.workspaceId === workspaceId) {
      ptyKill(terminalId)
      inputBuffers.delete(terminalId)
      lastInputAt.delete(terminalId)
    }
  }

  unregisterWorktreePaths(workspaceId)
  clearWorkspaceTerminals(workspaceId)
}

export function notifyWorkspaceVisited(workspaceId: string): void {
  handleWorkspaceVisited(workspaceId)
}

// ─── Terminal CRUD (called by IPC handlers) ─────────────────────────────────

const MAX_TERMINALS_PER_WORKSPACE = 10

export function createTerminal(workspaceId: string, terminalId?: string): WorkspaceTerminalEntry {
  const existingTerminals = getActiveTerminalsByWorkspace(workspaceId)
  if (existingTerminals.length >= MAX_TERMINALS_PER_WORKSPACE) {
    throw new Error(`Maximum ${MAX_TERMINALS_PER_WORKSPACE} terminals per workspace`)
  }

  // Resolve cwd from worktree path
  let cwd = process.cwd()
  for (const [wtPath, wsId] of worktreePathToWorkspaceId) {
    if (wsId === workspaceId) {
      cwd = wtPath
      break
    }
  }

  // Use provided terminalId (pre-generated by extension) or generate a new one
  const finalTerminalId = terminalId ?? crypto.randomUUID()

  // Count existing terminals for label
  const nextNumber = existingTerminals.length + 1
  const label = `Terminal ${nextNumber}`

  // Insert DB record
  const t0 = Date.now()
  const record = createTerminalRecord({
    workspaceId,
    terminalId: finalTerminalId,
    label
  })
  console.log(`[terminal] createTerminalRecord took ${Date.now() - t0}ms`)

  // Spawn PTY
  const ptyStart = Date.now()
  const shellPid = ptySpawn(finalTerminalId, cwd)
  console.log(`[terminal] ptySpawn took ${Date.now() - ptyStart}ms, shellPid=${shellPid}`)

  // Register in state machine
  handleTerminalSpawned(
    finalTerminalId,
    workspaceId,
    record.id,
    label,
    record.displayOrder,
    shellPid
  )

  return getWorkspaceTerminals(workspaceId).find((t) => t.terminalId === finalTerminalId)!
}

export function killTerminalById(dbRecordId: string): void {
  const record = getTerminalById(dbRecordId)
  if (!record) return

  ptyKill(record.terminalId)
  inputBuffers.delete(record.terminalId)
  lastInputAt.delete(record.terminalId)
  handleTerminalRemoved(record.terminalId)
  deleteTerminalRecord(dbRecordId)
}

export function respawnTerminal(dbRecordId: string): WorkspaceTerminalEntry | null {
  const record = getTerminalById(dbRecordId)
  if (!record) {
    console.log(`[terminal] respawn: DB record not found for dbRecordId=${dbRecordId}`)
    return null
  }

  // Resolve cwd from worktree path for this workspace
  let cwd: string | null = null
  for (const [wtPath, wsId] of worktreePathToWorkspaceId) {
    if (wsId === record.workspaceId) {
      cwd = wtPath
      break
    }
  }

  if (!cwd) {
    console.log(
      `[terminal] respawn: worktree path not yet registered for workspace ${record.workspaceId}, label="${record.label}" — will retry`
    )
    return null
  }

  // Clean up old PTY if still alive from previous spawn
  const oldTerminalId = record.terminalId
  if (oldTerminalId) {
    ptyKill(oldTerminalId)
    inputBuffers.delete(oldTerminalId)
    lastInputAt.delete(oldTerminalId)
  }

  // Generate new terminal ID
  const newTerminalId = crypto.randomUUID()

  // Update DB record with new PTY ID
  updateTerminalPtyId(dbRecordId, newTerminalId)

  // Spawn fresh PTY
  const shellPid = ptySpawn(newTerminalId, cwd)

  // Register in state machine
  handleTerminalSpawned(
    newTerminalId,
    record.workspaceId,
    dbRecordId,
    record.label,
    record.displayOrder,
    shellPid
  )

  return getWorkspaceTerminals(record.workspaceId).find((t) => t.id === dbRecordId) ?? null
}

export function renameTerminal(dbRecordId: string, label: string): void {
  const record = getTerminalById(dbRecordId)
  if (!record) return

  updateTerminalLabel(dbRecordId, label)
  handleTerminalRenamed(record.terminalId, label)
}

export function listTerminals(workspaceId: string): WorkspaceTerminalEntry[] {
  return getWorkspaceTerminals(workspaceId)
}

// ─── Pending agent launch queue ──────────────────────────────────────────────
// Commands queued until the correct workspace is loaded in VS Code.
// Verified by matching workspace folders to workspaceId via worktree path mapping.

type PendingLaunch = { command: string; workspaceId: string; createdAt: number }
const pendingLaunches: PendingLaunch[] = []
const PENDING_LAUNCH_TTL_MS = 60_000

/** Check if the given folders contain a worktree that maps to the target workspaceId. */
function foldersMatchWorkspace(folders: string[], targetWorkspaceId: string): boolean {
  for (const folder of folders) {
    const wsId = worktreePathToWorkspaceId.get(folder)
    if (wsId === targetWorkspaceId) return true
  }
  return false
}

/** Process queued launches against the extension's current workspace folders. */
function processPendingLaunches(folders: string[]): void {
  const now = Date.now()
  let i = 0
  while (i < pendingLaunches.length) {
    const launch = pendingLaunches[i]
    if (now - launch.createdAt > PENDING_LAUNCH_TTL_MS) {
      console.log(
        `[terminal] Dropping expired pending launch for workspace ${launch.workspaceId.slice(0, 8)}`
      )
      pendingLaunches.splice(i, 1)
      continue
    }
    if (foldersMatchWorkspace(folders, launch.workspaceId)) {
      console.log(`[terminal] Launching agent in workspace ${launch.workspaceId.slice(0, 8)}`)
      sendToExtension({ type: 'CONTROL.CREATE_TERMINAL', command: launch.command })
      pendingLaunches.splice(i, 1)
      continue
    }
    i++
  }
}

// Wire: when extension reports workspace folders (on connect or workspace switch),
// check if any pending launches can now fire.
setOnWorkspaceFoldersChanged((folders) => {
  console.log(
    `[terminal] Workspace folders changed (${folders.length} folders) — checking pending launches`
  )
  processPendingLaunches(folders)
})

/** Write text to a terminal's PTY as if the user typed it. Also tracks input for command detection. */
export function writeTerminalInput(terminalId: string, data: string): void {
  handleUserInput(terminalId, data)
  ptyWrite(terminalId, data)
}

/** Request the VS Code extension to create a new terminal and run a command in it.
 *  If the extension is connected and the correct workspace is loaded, sends immediately.
 *  Otherwise queues the request until the workspace folders match. */
export function requestTerminalWithCommand(command: string, workspaceId: string): boolean {
  if (isExtensionConnected() && foldersMatchWorkspace(getExtensionFolders(), workspaceId)) {
    console.log(`[terminal] Extension ready with correct workspace — launching immediately`)
    return sendToExtension({ type: 'CONTROL.CREATE_TERMINAL', command })
  }
  console.log(`[terminal] Workspace ${workspaceId.slice(0, 8)} not ready — queuing launch`)
  pendingLaunches.push({ command, workspaceId, createdAt: Date.now() })
  return true
}

export { getWorkspaceTerminals, resolveWorkspaceId }

// ─── Wire API handlers + input tracking for Express server (avoids circular import)
setApiHandlers(createTerminal, killTerminalById, respawnTerminal, renameTerminal)
setOnUserInput(handleUserInput)
