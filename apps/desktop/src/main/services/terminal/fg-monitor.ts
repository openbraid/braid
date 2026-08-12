// Foreground process monitor.
// Polls every 500ms per tracked terminal to detect when a command finishes.
// Uses `pgrep -P <shellPid>` to check if the shell has child processes.
// No children = command finished. Works regardless of job control mode.
// Pure Node.js — no Electron imports.

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ─── Types ───────────────────────────────────────────────────────────────────

type TrackedTerminal = {
  terminalId: string
  shellPid: number
  hasChildren: boolean    // true = a command is running
}

// ─── State ───────────────────────────────────────────────────────────────────

const tracked = new Map<string, TrackedTerminal>()
let pollTimer: NodeJS.Timeout | null = null

// Called when command finishes (children → no children)
let onShellForeground: ((terminalId: string) => void) | null = null

const POLL_INTERVAL_MS = 500

// ─── Callback ────────────────────────────────────────────────────────────────

export function setOnShellForeground(cb: (terminalId: string) => void): void {
  onShellForeground = cb
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function startMonitoring(terminalId: string, shellPid: number): void {
  tracked.set(terminalId, {
    terminalId,
    shellPid,
    hasChildren: false  // starts idle (no command running yet)
  })

  ensurePollRunning()
}

/** Called when a command is detected (user pressed Enter with a monitored command).
 *  Sets hasChildren = true so the next poll that sees no children triggers completion. */
export function notifyCommandStarted(terminalId: string): void {
  const entry = tracked.get(terminalId)
  if (entry) entry.hasChildren = true
}

export function stopMonitoring(terminalId: string): void {
  tracked.delete(terminalId)

  if (tracked.size === 0 && pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

export function stopAll(): void {
  tracked.clear()
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function ensurePollRunning(): void {
  if (pollTimer !== null) return
  schedulePoll()
}

function schedulePoll(): void {
  pollTimer = setTimeout(async () => {
    await pollAll()
    if (tracked.size > 0) {
      schedulePoll()
    } else {
      pollTimer = null
    }
  }, POLL_INTERVAL_MS)
}

async function pollAll(): Promise<void> {
  await Promise.allSettled(
    [...tracked.values()].map(entry => pollOne(entry))
  )
}

async function pollOne(entry: TrackedTerminal): Promise<void> {
  const children = await hasChildProcesses(entry.shellPid)

  if (children === null) return

  const hadChildren = entry.hasChildren
  entry.hasChildren = children

  // Transition: had children → no children = command finished
  if (hadChildren && !children) {
    onShellForeground?.(entry.terminalId)
  }
}

async function hasChildProcesses(pid: number): Promise<boolean | null> {
  try {
    await execFileAsync('/usr/bin/pgrep', ['-P', String(pid)], { timeout: 1000 })
    return true  // pgrep found children (exit code 0)
  } catch (err) {
    const exitCode = (err as { code?: number }).code
    if (exitCode === 1) return false  // pgrep exit 1 = no children found
    return null  // actual error (timeout, pgrep not found, etc.)
  }
}
