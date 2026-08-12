// Manages node-pty process instances.
// Pure Node.js — no Electron imports. Callbacks set by index.ts for wiring.

import { spawn as ptySpawn, type IPty } from '@lydell/node-pty'
import { getShellIntegrationEnv } from './shell-integration'

// ─── Store ───────────────────────────────────────────────────────────────────

type PtyEntry = {
  pty: IPty
  shellPid: number
}

const ptys = new Map<string, PtyEntry>()

// ─── Callbacks (set once by index.ts) ────────────────────────────────────────

let onData: ((terminalId: string, data: string) => void) | null = null
let onExit: ((terminalId: string, exitCode: number) => void) | null = null

export function setOnData(cb: (terminalId: string, data: string) => void): void {
  onData = cb
}

export function setOnExit(cb: (terminalId: string, exitCode: number) => void): void {
  onExit = cb
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function spawnTerminal(
  terminalId: string,
  cwd: string,
  cols = 80,
  rows = 24
): number {
  if (ptys.has(terminalId)) {
    throw new Error(`Terminal ${terminalId} already exists`)
  }

  const shell = process.env.SHELL || '/bin/zsh'
  const shellIntegrationEnv = getShellIntegrationEnv(shell)

  const pty = ptySpawn(shell, ['--login'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, ...shellIntegrationEnv } as Record<string, string>
  })

  const shellPid = pty.pid

  ptys.set(terminalId, { pty, shellPid })

  pty.onData((data) => {
    onData?.(terminalId, data)
  })

  pty.onExit(({ exitCode }) => {
    ptys.delete(terminalId)
    onExit?.(terminalId, exitCode ?? 0)
  })

  console.log(`[pty-manager] Spawned terminal ${terminalId} (pid=${shellPid}, shell=${shell}, cwd=${cwd})`)
  return shellPid
}

export function writeToTerminal(terminalId: string, data: string): void {
  const entry = ptys.get(terminalId)
  if (!entry) return
  // Temporary debug: log non-keystroke writes to trace the webview-panel URI bug
  if (data.length > 20) {
    console.log(`[pty-manager] write to ${terminalId.slice(0, 8)}: ${JSON.stringify(data.slice(0, 120))}`)
  }
  entry.pty.write(data)
}

export function resizeTerminal(terminalId: string, cols: number, rows: number): void {
  const entry = ptys.get(terminalId)
  if (!entry) return
  try {
    entry.pty.resize(cols, rows)
  } catch {
    // Terminal may have exited between check and resize — ignore
  }
}

export function killTerminal(terminalId: string): void {
  const entry = ptys.get(terminalId)
  if (!entry) return

  console.log(`[pty-manager] Killing terminal ${terminalId} (pid=${entry.shellPid})`)
  try {
    entry.pty.kill()
  } catch {
    // Already dead
  }
  // onExit callback will clean up the Map entry
}

export function getShellPid(terminalId: string): number | undefined {
  return ptys.get(terminalId)?.shellPid
}

export function isAlive(terminalId: string): boolean {
  return ptys.has(terminalId)
}

export function killAll(): void {
  for (const [terminalId] of ptys) {
    killTerminal(terminalId)
  }
}
