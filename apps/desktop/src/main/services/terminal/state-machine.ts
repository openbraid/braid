// All terminal state business logic lives here.
// No Electron imports (BrowserWindow, ipcMain, app). Pure state transitions only.
// index.ts wires the onStateChange callback for IPC push.

import type { InternalTerminalEntry } from './types'
import type { WorkspaceTerminalEntry } from '../../../shared/ipc-types'

// ─── Monitored commands ─────────────────────────────────────────────────────
// Only these commands show status on workspace cards.
// Interactive: use output-gap detection (3.3s silence → idle).
// Non-interactive: stay RUNNING while fg != shell, FINISHED when fg returns.

const MONITORED_INTERACTIVE = new Set([
  'claude',
  'codex',
  'aider',
  'gemini',
  'goose',
  'droid',
  'agent',
  'cursor-agent',
  'amp',
  'copilot',
  'vibe',
  'qwen',
  'auggie',
  'opencode',
  'crush',
  'cline',
  'kiro-cli'
])

const MONITORED_NON_INTERACTIVE_PREFIXES = [
  // Package managers
  'npm install',
  'npm run',
  'npm test',
  'npm build',
  'npm ci',
  'yarn install',
  'yarn build',
  'yarn test',
  'yarn add',
  'pnpm install',
  'pnpm run',
  'pnpm test',
  'pnpm build',
  'pnpm add',
  'bun install',
  'bun run',
  'bun test',
  'bun build',
  'pip install',
  'pip3 install',
  'bundle install',
  // Build tools
  'cargo build',
  'cargo test',
  'cargo run',
  'go build',
  'go test',
  'go run',
  'make',
  'cmake',
  'mvn',
  'gradle',
  'dotnet build',
  'dotnet test',
  'dotnet run',
  // Frontend build
  'tsc',
  'webpack',
  'vite build',
  'next build',
  'next dev',
  'eslint',
  'prettier',
  // Test runners
  'pytest',
  'jest',
  'vitest',
  'mocha',
  // Containers & infra
  'docker build',
  'docker compose',
  'terraform plan',
  'terraform apply',
  'cdk deploy',
  'cdk synth',
  'cdk diff',
  'kubectl apply',
  'kubectl delete',
  'sam build',
  'sam deploy',
  'pulumi up',
  'pulumi preview',
  // Git
  'git clone',
  'git pull',
  'git push',
  'git fetch'
]

// Custom per-project monitored commands loaded from DB.
// Refreshed when the user adds/removes commands in project settings.
let customNonInteractivePrefixes: string[] = []

export function setCustomMonitoredCommands(commands: string[]): void {
  customNonInteractivePrefixes = commands
}

export type MonitoredCommandMatch = {
  command: string // what the user typed (first word or matched prefix)
  isInteractive: boolean
} | null

// Match user input against monitored lists.
// Returns null if the command is not monitored.
export function matchMonitoredCommand(rawInput: string): MonitoredCommandMatch {
  const trimmed = rawInput.trim()
  if (!trimmed) return null

  // Check non-interactive prefixes first (multi-word matches) — defaults + custom
  const allPrefixes = [...MONITORED_NON_INTERACTIVE_PREFIXES, ...customNonInteractivePrefixes]
  for (const prefix of allPrefixes) {
    if (trimmed === prefix || trimmed.startsWith(prefix + ' ')) {
      return { command: prefix, isInteractive: false }
    }
  }

  // Check interactive commands (single-word match on first token)
  const baseCommand = trimmed.split(/\s+/)[0]
  if (MONITORED_INTERACTIVE.has(baseCommand)) {
    return { command: baseCommand, isInteractive: true }
  }

  return null
}

// ─── Module-level stores ────────────────────────────────────────────────────

// Primary store: terminalId (runtime PTY ID) → InternalTerminalEntry
export const terminalStore = new Map<string, InternalTerminalEntry>()

// Silence timers: terminalId → timer handle
const silenceTimers = new Map<string, NodeJS.Timeout>()

// Dismiss timers: terminalId → timer handle (5s countdown after completed)
const dismissTimers = new Map<string, NodeJS.Timeout>()

// ─── Constants ──────────────────────────────────────────────────────────────

const SILENCE_THRESHOLD_MS = 3300
const DISMISS_DELAY_MS = 5000

// ─── State change callback ──────────────────────────────────────────────────
// Set by index.ts so state machine can trigger IPC push without importing IPC directly.

let onStateChange: ((workspaceId: string) => void) | null = null

export function setOnStateChange(cb: (workspaceId: string) => void): void {
  onStateChange = cb
}

function notifyChange(workspaceId: string): void {
  onStateChange?.(workspaceId)
}

// ─── WorkspaceId resolution ─────────────────────────────────────────────────
// Populated by workspace service on create/open/repair and on startup hydration.
// Key: absolute worktree path  Value: workspaceId

export const worktreePathToWorkspaceId = new Map<string, string>()

export function registerWorktreePath(worktreePath: string, workspaceId: string): void {
  worktreePathToWorkspaceId.set(worktreePath, workspaceId)
}

export function unregisterWorktreePaths(workspaceId: string): void {
  for (const [p, wsId] of worktreePathToWorkspaceId) {
    if (wsId === workspaceId) worktreePathToWorkspaceId.delete(p)
  }
}

export function resolveWorkspaceId(cwd: string): string | null {
  for (const [worktreePath, workspaceId] of worktreePathToWorkspaceId) {
    if (cwd === worktreePath || cwd.startsWith(worktreePath + '/')) {
      return workspaceId
    }
  }
  return null
}

// ─── Mapping: internal → shared IPC type ────────────────────────────────────
// Strips internal-only fields before pushing to renderer.

function toShared(entry: InternalTerminalEntry): WorkspaceTerminalEntry {
  return {
    id: entry.dbRecordId,
    terminalId: entry.terminalId,
    workspaceId: entry.workspaceId,
    label: entry.label,
    displayOrder: entry.displayOrder,
    isActive: entry.isActive,
    status: entry.status,
    command: entry.command,
    exitCode: entry.exitCode,
    completedAt: entry.completedAt
  }
}

// ─── Query ──────────────────────────────────────────────────────────────────

export function getWorkspaceTerminals(workspaceId: string): WorkspaceTerminalEntry[] {
  const result: WorkspaceTerminalEntry[] = []
  for (const entry of terminalStore.values()) {
    if (entry.workspaceId === workspaceId) {
      result.push(toShared(entry))
    }
  }
  return result.sort((a, b) => a.displayOrder - b.displayOrder)
}

// ─── State transitions ─────────────────────────────────────────────────────

export function handleTerminalSpawned(
  terminalId: string,
  workspaceId: string,
  dbRecordId: string,
  label: string,
  displayOrder: number,
  shellPid: number
): void {
  const entry: InternalTerminalEntry = {
    terminalId,
    dbRecordId,
    workspaceId,
    label,
    displayOrder,
    isActive: true,
    shellPid,
    command: null,
    exitCode: null,
    status: 'idle',
    lastOutputAt: null,
    completedAt: null,
    seenByUser: false
  }

  terminalStore.set(terminalId, entry)
  notifyChange(workspaceId)
}

export function handleTerminalExited(
  terminalId: string,
  exitCode: number,
  activeWorkspaceId?: string | null
): void {
  const entry = terminalStore.get(terminalId)
  if (!entry) return

  clearSilenceTimer(terminalId)
  clearDismissTimer(terminalId)

  entry.status = 'completed'
  entry.exitCode = exitCode
  entry.isActive = false
  entry.completedAt = Date.now()

  // Start dismiss timer only if the user is currently viewing this workspace.
  // Otherwise the green pill stays until they visit (handleWorkspaceVisited).
  if (activeWorkspaceId === entry.workspaceId) {
    startDismissTimer(terminalId)
  }
  notifyChange(entry.workspaceId)
}

// Called when user presses Enter and the command matches the monitored list.
export function handleCommandDetected(
  terminalId: string,
  command: string,
  isInteractive: boolean
): void {
  const entry = terminalStore.get(terminalId)
  console.log(
    `[state-machine] handleCommandDetected: terminalId=${terminalId.slice(0, 8)}, command="${command}", entryFound=${!!entry}, storeSize=${terminalStore.size}`
  )
  if (!entry) return

  clearSilenceTimer(terminalId)
  clearDismissTimer(terminalId)

  entry.command = command
  entry.exitCode = null
  entry.completedAt = null
  entry.seenByUser = false

  if (isInteractive) {
    // Interactive agent: start as idle, output-gap detection will transition to running
    entry.status = 'idle'
  } else {
    // Non-interactive: running immediately
    entry.status = 'running'
  }

  notifyChange(entry.workspaceId)
}

// Called by FgMonitor when foreground returns to shell.
// This means whatever command was running has finished.
export function handleFgReturnedToShell(
  terminalId: string,
  activeWorkspaceId?: string | null
): void {
  const entry = terminalStore.get(terminalId)
  if (!entry) return

  // Only act if we were tracking a command
  if (entry.command === null) return

  clearSilenceTimer(terminalId)

  dbg(terminalId, 'fg-returned:->completed', { command: entry.command, from: entry.status })

  // Mark as completed — keep command name so the pill stays visible.
  entry.status = 'completed'
  entry.exitCode = 0
  entry.completedAt = Date.now()

  if (activeWorkspaceId === entry.workspaceId) {
    startDismissTimer(terminalId)
  }
  notifyChange(entry.workspaceId)
}

export function handleOutputActivity(terminalId: string): void {
  const entry = terminalStore.get(terminalId)
  if (!entry || !entry.command) return
  if (entry.status === 'completed') return // don't let flushing output override completion

  entry.lastOutputAt = Date.now()

  // Only use output-gap detection for interactive commands
  if (!MONITORED_INTERACTIVE.has(entry.command)) return

  if (entry.status !== 'running') {
    entry.status = 'running'
    notifyChange(entry.workspaceId)
  }

  resetSilenceTimer(terminalId)
}

export function handleTerminalRenamed(terminalId: string, label: string): void {
  const entry = terminalStore.get(terminalId)
  if (!entry) return

  entry.label = label
  notifyChange(entry.workspaceId)
}

export function handleTerminalRemoved(terminalId: string): void {
  const entry = terminalStore.get(terminalId)
  if (!entry) return

  clearSilenceTimer(terminalId)
  clearDismissTimer(terminalId)
  terminalStore.delete(terminalId)
  notifyChange(entry.workspaceId)
}

// Called when the user navigates to a workspace tab.
// Starts dismiss countdown for any completed commands.
export function handleWorkspaceVisited(workspaceId: string): void {
  for (const entry of terminalStore.values()) {
    if (entry.workspaceId !== workspaceId || entry.status !== 'completed') continue

    // Start dismiss timer if not already running
    if (!dismissTimers.has(entry.terminalId)) {
      startDismissTimer(entry.terminalId)
    }
  }
}

// Called on workspace close — immediately clear all state for that workspace.
export function clearWorkspaceTerminals(workspaceId: string): void {
  for (const [terminalId, entry] of terminalStore) {
    if (entry.workspaceId !== workspaceId) continue
    clearSilenceTimer(terminalId)
    clearDismissTimer(terminalId)
    terminalStore.delete(terminalId)
  }
  notifyChange(workspaceId)
}

// ─── Debug instrumentation ──────────────────────────────────────────────────
// Off unless BRAID_DEBUG_TERMINAL=1. Throttled per (terminal, tag) so a
// high-frequency PTY stream cannot flood the log and change the timing of the
// very thing being measured.

const DEBUG_TERMINAL = process.env.BRAID_DEBUG_TERMINAL === '1'
const lastDebugAt = new Map<string, number>()
const DEBUG_THROTTLE_MS = 1000

function dbg(terminalId: string, tag: string, detail: Record<string, unknown>): void {
  if (!DEBUG_TERMINAL) return
  const key = `${terminalId}:${tag}`
  const now = Date.now()
  if (now - (lastDebugAt.get(key) ?? 0) < DEBUG_THROTTLE_MS) return
  lastDebugAt.set(key, now)
  console.log(`[term-dbg] ${tag} ${terminalId.slice(0, 8)}`, JSON.stringify(detail))
}

// ─── Silence timer (3.3s) ───────────────────────────────────────────────────
// After 3.3s of silence: running → idle (for interactive commands only).

function startSilenceTimer(terminalId: string): void {
  const timer = setTimeout(() => {
    silenceTimers.delete(terminalId)
    const entry = terminalStore.get(terminalId)
    if (!entry || entry.status !== 'running') return

    dbg(terminalId, 'silence:->idle', {
      command: entry.command,
      msSinceOutput: Date.now() - (entry.lastOutputAt ?? 0)
    })
    entry.status = 'idle'
    notifyChange(entry.workspaceId)
  }, SILENCE_THRESHOLD_MS)

  silenceTimers.set(terminalId, timer)
}

function resetSilenceTimer(terminalId: string): void {
  clearSilenceTimer(terminalId)
  const entry = terminalStore.get(terminalId)
  if (entry && entry.command !== null && MONITORED_INTERACTIVE.has(entry.command)) {
    startSilenceTimer(terminalId)
  }
}

function clearSilenceTimer(terminalId: string): void {
  const timer = silenceTimers.get(terminalId)
  if (timer !== undefined) {
    clearTimeout(timer)
    silenceTimers.delete(terminalId)
  }
}

// ─── Dismiss timer (5s) ─────────────────────────────────────────────────────
// After 5s of being visible as "completed": reset entry to idle (pill disappears).
// Does NOT delete the terminal entry — the terminal is still alive.

function startDismissTimer(terminalId: string): void {
  if (dismissTimers.has(terminalId)) return // already running

  const timer = setTimeout(() => {
    dismissTimers.delete(terminalId)
    const entry = terminalStore.get(terminalId)
    console.log(
      `[state-machine] Dismiss timer fired: terminalId=${terminalId.slice(0, 8)}, entryFound=${!!entry}, status=${entry?.status}, storeSize=${terminalStore.size}`
    )
    if (!entry || entry.status !== 'completed') return

    // Reset to idle — terminal is still alive, just no command tracked
    entry.command = null
    entry.exitCode = null
    entry.completedAt = null
    entry.seenByUser = false
    entry.status = 'idle'
    notifyChange(entry.workspaceId)
  }, DISMISS_DELAY_MS)

  dismissTimers.set(terminalId, timer)
}

function clearDismissTimer(terminalId: string): void {
  const timer = dismissTimers.get(terminalId)
  if (timer !== undefined) {
    clearTimeout(timer)
    dismissTimers.delete(terminalId)
  }
}

// ─── Full reset (logout) ───────────────────────────────────────────────────

export function clearAllTerminalState(): void {
  for (const timer of silenceTimers.values()) clearTimeout(timer)
  silenceTimers.clear()
  for (const timer of dismissTimers.values()) clearTimeout(timer)
  dismissTimers.clear()
  terminalStore.clear()
  worktreePathToWorkspaceId.clear()
}
