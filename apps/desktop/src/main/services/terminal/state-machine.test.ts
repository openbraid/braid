import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearAllTerminalState,
  clearWorkspaceTerminals,
  getWorkspaceTerminals,
  handleCommandDetected,
  handleFgReturnedToShell,
  handleOutputActivity,
  handleTerminalExited,
  handleTerminalRemoved,
  handleTerminalRenamed,
  handleTerminalSpawned,
  handleWorkspaceVisited,
  matchMonitoredCommand,
  registerWorktreePath,
  resolveWorkspaceId,
  setCustomMonitoredCommands,
  setOnStateChange,
  terminalStore,
  unregisterWorktreePaths
} from './state-machine'
import type { InternalTerminalEntry } from './types'

const WS = 'workspace-1'
const OTHER_WS = 'workspace-2'
const SILENCE_MS = 3300
const DISMISS_MS = 5000

// Spawns a terminal with sensible defaults so each test only states what it cares about.
function spawn(
  terminalId: string,
  overrides: { workspaceId?: string; displayOrder?: number; label?: string } = {}
): void {
  handleTerminalSpawned(
    terminalId,
    overrides.workspaceId ?? WS,
    `db-${terminalId}`,
    overrides.label ?? `Terminal ${terminalId}`,
    overrides.displayOrder ?? 0,
    1000
  )
}

function entryOf(terminalId: string): InternalTerminalEntry {
  const entry = terminalStore.get(terminalId)
  if (!entry) throw new Error(`no terminal entry for ${terminalId}`)
  return entry
}

beforeEach(() => {
  vi.useFakeTimers()
  // The store, the custom command list and the change callback are all
  // module-level singletons — a leak between tests would be invisible.
  clearAllTerminalState()
  setCustomMonitoredCommands([])
  setOnStateChange(() => {})
  // handleCommandDetected and the dismiss timer log unconditionally.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  clearAllTerminalState()
  vi.useRealTimers()
})

// ─── matchMonitoredCommand ──────────────────────────────────────────────────

describe('matchMonitoredCommand', () => {
  it('matches a bare interactive agent', () => {
    expect(matchMonitoredCommand('claude')).toEqual({ command: 'claude', isInteractive: true })
  })

  it('matches an interactive agent with arguments', () => {
    expect(matchMonitoredCommand('claude --resume some-session')).toEqual({
      command: 'claude',
      isInteractive: true
    })
  })

  it('reports the base command, not the full input', () => {
    expect(matchMonitoredCommand('codex exec "fix the build"')?.command).toBe('codex')
  })

  it('ignores surrounding whitespace', () => {
    expect(matchMonitoredCommand('   aider   ')).toEqual({ command: 'aider', isInteractive: true })
  })

  it('matches a multi-word non-interactive prefix exactly', () => {
    expect(matchMonitoredCommand('npm install')).toEqual({
      command: 'npm install',
      isInteractive: false
    })
  })

  it('matches a non-interactive prefix with trailing arguments', () => {
    expect(matchMonitoredCommand('npm run build --watch')).toEqual({
      command: 'npm run',
      isInteractive: false
    })
  })

  it('matches a single-word non-interactive command', () => {
    expect(matchMonitoredCommand('tsc --noEmit')).toEqual({
      command: 'tsc',
      isInteractive: false
    })
  })

  it('prefers the non-interactive prefix list over the first token', () => {
    // 'git' alone is not monitored; only the four network subcommands are.
    expect(matchMonitoredCommand('git push origin main')).toEqual({
      command: 'git push',
      isInteractive: false
    })
  })

  it('does not match a command that merely starts with monitored letters', () => {
    expect(matchMonitoredCommand('npminstall')).toBeNull()
    expect(matchMonitoredCommand('claudette')).toBeNull()
  })

  it('does not match an unmonitored git subcommand', () => {
    expect(matchMonitoredCommand('git status')).toBeNull()
  })

  it('is case sensitive — shells are', () => {
    expect(matchMonitoredCommand('Claude')).toBeNull()
    expect(matchMonitoredCommand('NPM install')).toBeNull()
  })

  it('returns null for empty and whitespace-only input', () => {
    expect(matchMonitoredCommand('')).toBeNull()
    expect(matchMonitoredCommand('   \t ')).toBeNull()
  })

  it('returns null for an ordinary command', () => {
    expect(matchMonitoredCommand('ls -la')).toBeNull()
  })
})

describe('setCustomMonitoredCommands', () => {
  it('makes a custom command match as non-interactive', () => {
    expect(matchMonitoredCommand('rake db:migrate')).toBeNull()

    setCustomMonitoredCommands(['rake db:migrate'])

    expect(matchMonitoredCommand('rake db:migrate')).toEqual({
      command: 'rake db:migrate',
      isInteractive: false
    })
  })

  it('matches a custom command with trailing arguments', () => {
    setCustomMonitoredCommands(['just deploy'])
    expect(matchMonitoredCommand('just deploy staging')).toEqual({
      command: 'just deploy',
      isInteractive: false
    })
  })

  it('replaces the previous custom list rather than appending', () => {
    setCustomMonitoredCommands(['rake'])
    setCustomMonitoredCommands(['bazel build'])

    expect(matchMonitoredCommand('rake')).toBeNull()
    expect(matchMonitoredCommand('bazel build //...')).toEqual({
      command: 'bazel build',
      isInteractive: false
    })
  })

  it('leaves built-in commands matching after a custom list is set', () => {
    setCustomMonitoredCommands(['bazel build'])
    expect(matchMonitoredCommand('claude')).toEqual({ command: 'claude', isInteractive: true })
  })

  it('clears custom commands when given an empty list', () => {
    setCustomMonitoredCommands(['bazel build'])
    setCustomMonitoredCommands([])
    expect(matchMonitoredCommand('bazel build')).toBeNull()
  })
})

// ─── Spawn / rename / remove ────────────────────────────────────────────────

describe('handleTerminalSpawned', () => {
  it('creates an idle, active entry with no command', () => {
    spawn('t1')

    const entry = entryOf('t1')
    expect(entry.status).toBe('idle')
    expect(entry.isActive).toBe(true)
    expect(entry.command).toBeNull()
    expect(entry.exitCode).toBeNull()
    expect(entry.completedAt).toBeNull()
  })

  it('notifies the workspace', () => {
    const onChange = vi.fn()
    setOnStateChange(onChange)

    spawn('t1')

    expect(onChange).toHaveBeenCalledWith(WS)
  })
})

describe('handleTerminalRenamed', () => {
  it('updates the label', () => {
    spawn('t1')
    handleTerminalRenamed('t1', 'Build')
    expect(entryOf('t1').label).toBe('Build')
  })

  it('is a no-op for an unknown terminal', () => {
    expect(() => handleTerminalRenamed('nope', 'x')).not.toThrow()
  })
})

describe('handleTerminalRemoved', () => {
  it('deletes the entry and notifies its workspace', () => {
    const onChange = vi.fn()
    spawn('t1')
    setOnStateChange(onChange)

    handleTerminalRemoved('t1')

    expect(terminalStore.has('t1')).toBe(false)
    expect(onChange).toHaveBeenCalledWith(WS)
  })

  it('cancels a pending dismiss timer so a removed terminal cannot be resurrected', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm install', false)
    handleTerminalExited('t1', 0, WS)

    handleTerminalRemoved('t1')
    vi.advanceTimersByTime(DISMISS_MS)

    expect(terminalStore.has('t1')).toBe(false)
  })

  it('is a no-op for an unknown terminal', () => {
    const onChange = vi.fn()
    setOnStateChange(onChange)

    handleTerminalRemoved('nope')

    expect(onChange).not.toHaveBeenCalled()
  })
})

// ─── handleCommandDetected ──────────────────────────────────────────────────

describe('handleCommandDetected', () => {
  it('sets a non-interactive command to running immediately', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm install', false)

    const entry = entryOf('t1')
    expect(entry.status).toBe('running')
    expect(entry.command).toBe('npm install')
  })

  it('leaves an interactive command idle until output arrives', () => {
    spawn('t1')
    handleCommandDetected('t1', 'claude', true)

    expect(entryOf('t1').status).toBe('idle')
    expect(entryOf('t1').command).toBe('claude')
  })

  it('clears completion state from the previous command', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm test', false)
    handleFgReturnedToShell('t1', WS)
    expect(entryOf('t1').status).toBe('completed')

    handleCommandDetected('t1', 'npm run build', false)

    const entry = entryOf('t1')
    expect(entry.status).toBe('running')
    expect(entry.exitCode).toBeNull()
    expect(entry.completedAt).toBeNull()
    expect(entry.seenByUser).toBe(false)
  })

  it('cancels the pending dismiss timer of the previous command', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm test', false)
    handleFgReturnedToShell('t1', WS)

    handleCommandDetected('t1', 'npm run build', false)
    vi.advanceTimersByTime(DISMISS_MS)

    // The stale dismiss must not wipe the command that replaced it.
    expect(entryOf('t1').status).toBe('running')
    expect(entryOf('t1').command).toBe('npm run build')
  })

  it('is a no-op for an unknown terminal', () => {
    expect(() => handleCommandDetected('nope', 'claude', true)).not.toThrow()
    expect(terminalStore.size).toBe(0)
  })
})

// ─── handleOutputActivity ───────────────────────────────────────────────────

describe('handleOutputActivity', () => {
  it('moves an interactive command from idle to running', () => {
    spawn('t1')
    handleCommandDetected('t1', 'claude', true)

    handleOutputActivity('t1')

    expect(entryOf('t1').status).toBe('running')
    expect(entryOf('t1').lastOutputAt).not.toBeNull()
  })

  it('returns to idle after the silence threshold', () => {
    spawn('t1')
    handleCommandDetected('t1', 'claude', true)
    handleOutputActivity('t1')

    vi.advanceTimersByTime(SILENCE_MS - 1)
    expect(entryOf('t1').status).toBe('running')

    vi.advanceTimersByTime(1)
    expect(entryOf('t1').status).toBe('idle')
  })

  it('keeps running while output keeps arriving', () => {
    spawn('t1')
    handleCommandDetected('t1', 'claude', true)

    for (let i = 0; i < 5; i++) {
      handleOutputActivity('t1')
      vi.advanceTimersByTime(SILENCE_MS - 100)
    }

    expect(entryOf('t1').status).toBe('running')
  })

  it('does not use output-gap detection for non-interactive commands', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm install', false)

    handleOutputActivity('t1')
    vi.advanceTimersByTime(SILENCE_MS * 3)

    // A quiet build is still a running build; only fg-return ends it.
    expect(entryOf('t1').status).toBe('running')
  })

  it('ignores output when no command is tracked', () => {
    spawn('t1')
    handleOutputActivity('t1')

    expect(entryOf('t1').status).toBe('idle')
    expect(entryOf('t1').lastOutputAt).toBeNull()
  })

  it('does not override a completed status with flushing output', () => {
    spawn('t1')
    handleCommandDetected('t1', 'claude', true)
    handleFgReturnedToShell('t1', null)

    handleOutputActivity('t1')

    expect(entryOf('t1').status).toBe('completed')
  })

  it('is a no-op for an unknown terminal', () => {
    expect(() => handleOutputActivity('nope')).not.toThrow()
  })
})

// ─── handleFgReturnedToShell ────────────────────────────────────────────────

describe('handleFgReturnedToShell', () => {
  it('completes a running command with exit code 0', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm install', false)

    handleFgReturnedToShell('t1', null)

    const entry = entryOf('t1')
    expect(entry.status).toBe('completed')
    expect(entry.exitCode).toBe(0)
    expect(entry.completedAt).toBeGreaterThan(0)
    expect(entry.command).toBe('npm install')
  })

  it('does nothing when no command is being tracked', () => {
    spawn('t1')

    handleFgReturnedToShell('t1', WS)

    expect(entryOf('t1').status).toBe('idle')
    expect(entryOf('t1').completedAt).toBeNull()
  })

  it('cancels the silence timer of an interactive command', () => {
    spawn('t1')
    handleCommandDetected('t1', 'claude', true)
    handleOutputActivity('t1')

    handleFgReturnedToShell('t1', null)
    vi.advanceTimersByTime(SILENCE_MS)

    expect(entryOf('t1').status).toBe('completed')
  })

  it('starts the dismiss countdown when the workspace is on screen', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm install', false)

    handleFgReturnedToShell('t1', WS)
    vi.advanceTimersByTime(DISMISS_MS)

    const entry = entryOf('t1')
    expect(entry.status).toBe('idle')
    expect(entry.command).toBeNull()
    expect(entry.exitCode).toBeNull()
    expect(entry.completedAt).toBeNull()
  })

  it('holds the completed pill while the user is elsewhere', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm install', false)

    handleFgReturnedToShell('t1', OTHER_WS)
    vi.advanceTimersByTime(DISMISS_MS * 4)

    expect(entryOf('t1').status).toBe('completed')
    expect(entryOf('t1').command).toBe('npm install')
  })

  it('is a no-op for an unknown terminal', () => {
    expect(() => handleFgReturnedToShell('nope', WS)).not.toThrow()
  })
})

// ─── handleTerminalExited ───────────────────────────────────────────────────

describe('handleTerminalExited', () => {
  it('records the exit code and deactivates the terminal', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm test', false)

    handleTerminalExited('t1', 1, null)

    const entry = entryOf('t1')
    expect(entry.status).toBe('completed')
    expect(entry.exitCode).toBe(1)
    expect(entry.isActive).toBe(false)
    expect(entry.completedAt).toBeGreaterThan(0)
  })

  it('completes a terminal that never ran a monitored command', () => {
    spawn('t1')

    handleTerminalExited('t1', 0, null)

    expect(entryOf('t1').status).toBe('completed')
    expect(entryOf('t1').exitCode).toBe(0)
  })

  it('starts the dismiss countdown when the workspace is on screen', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm test', false)

    handleTerminalExited('t1', 0, WS)
    vi.advanceTimersByTime(DISMISS_MS)

    expect(entryOf('t1').status).toBe('idle')
    expect(entryOf('t1').command).toBeNull()
  })

  it('holds the completed pill while the user is elsewhere', () => {
    spawn('t1')
    handleTerminalExited('t1', 130, OTHER_WS)
    vi.advanceTimersByTime(DISMISS_MS * 2)

    expect(entryOf('t1').status).toBe('completed')
    expect(entryOf('t1').exitCode).toBe(130)
  })

  it('cancels a pending silence timer', () => {
    spawn('t1')
    handleCommandDetected('t1', 'claude', true)
    handleOutputActivity('t1')

    handleTerminalExited('t1', 0, null)
    vi.advanceTimersByTime(SILENCE_MS)

    expect(entryOf('t1').status).toBe('completed')
  })

  it('is a no-op for an unknown terminal', () => {
    expect(() => handleTerminalExited('nope', 0, WS)).not.toThrow()
  })
})

// ─── handleWorkspaceVisited ─────────────────────────────────────────────────

describe('handleWorkspaceVisited', () => {
  it('starts the dismiss countdown for completed terminals of that workspace', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm test', false)
    handleTerminalExited('t1', 0, OTHER_WS)
    expect(entryOf('t1').status).toBe('completed')

    handleWorkspaceVisited(WS)
    vi.advanceTimersByTime(DISMISS_MS)

    expect(entryOf('t1').status).toBe('idle')
  })

  it('leaves other workspaces alone', () => {
    spawn('t1', { workspaceId: OTHER_WS })
    handleTerminalExited('t1', 0, null)

    handleWorkspaceVisited(WS)
    vi.advanceTimersByTime(DISMISS_MS)

    expect(entryOf('t1').status).toBe('completed')
  })

  it('does not touch running terminals', () => {
    spawn('t1')
    handleCommandDetected('t1', 'npm install', false)

    handleWorkspaceVisited(WS)
    vi.advanceTimersByTime(DISMISS_MS)

    expect(entryOf('t1').status).toBe('running')
  })

  it('does not restart an already-running dismiss countdown', () => {
    spawn('t1')
    handleTerminalExited('t1', 0, WS)

    vi.advanceTimersByTime(DISMISS_MS - 500)
    handleWorkspaceVisited(WS)
    vi.advanceTimersByTime(500)

    expect(entryOf('t1').status).toBe('idle')
  })
})

// ─── clearWorkspaceTerminals ────────────────────────────────────────────────

describe('clearWorkspaceTerminals', () => {
  it('removes only the terminals of the given workspace', () => {
    spawn('t1')
    spawn('t2')
    spawn('t3', { workspaceId: OTHER_WS })

    clearWorkspaceTerminals(WS)

    expect(terminalStore.has('t1')).toBe(false)
    expect(terminalStore.has('t2')).toBe(false)
    expect(terminalStore.has('t3')).toBe(true)
  })

  it('notifies the cleared workspace', () => {
    spawn('t1')
    const onChange = vi.fn()
    setOnStateChange(onChange)

    clearWorkspaceTerminals(WS)

    expect(onChange).toHaveBeenCalledWith(WS)
  })

  it('cancels pending timers for the cleared terminals', () => {
    spawn('t1')
    handleCommandDetected('t1', 'claude', true)
    handleOutputActivity('t1')
    spawn('t2')
    handleTerminalExited('t2', 0, WS)

    clearWorkspaceTerminals(WS)
    vi.advanceTimersByTime(DISMISS_MS + SILENCE_MS)

    expect(terminalStore.size).toBe(0)
  })
})

// ─── getWorkspaceTerminals ──────────────────────────────────────────────────

describe('getWorkspaceTerminals', () => {
  it('returns only terminals of the requested workspace', () => {
    spawn('t1', { displayOrder: 0 })
    spawn('t2', { workspaceId: OTHER_WS, displayOrder: 0 })

    const result = getWorkspaceTerminals(WS)

    expect(result).toHaveLength(1)
    expect(result[0].terminalId).toBe('t1')
  })

  it('sorts by displayOrder regardless of insertion order', () => {
    spawn('c', { displayOrder: 2 })
    spawn('a', { displayOrder: 0 })
    spawn('b', { displayOrder: 1 })

    expect(getWorkspaceTerminals(WS).map((t) => t.terminalId)).toEqual(['a', 'b', 'c'])
  })

  it('returns an empty array for an unknown workspace', () => {
    spawn('t1')
    expect(getWorkspaceTerminals('nope')).toEqual([])
  })

  it('projects the shared shape, dropping internal-only fields', () => {
    spawn('t1', { label: 'Build' })
    handleCommandDetected('t1', 'npm install', false)
    handleTerminalExited('t1', 2, null)

    const [shared] = getWorkspaceTerminals(WS)

    expect(shared).toEqual({
      id: 'db-t1',
      terminalId: 't1',
      workspaceId: WS,
      label: 'Build',
      displayOrder: 0,
      isActive: false,
      status: 'completed',
      command: 'npm install',
      exitCode: 2,
      completedAt: expect.any(Number)
    })
    expect(shared).not.toHaveProperty('shellPid')
    expect(shared).not.toHaveProperty('seenByUser')
  })
})

// ─── Worktree path resolution ───────────────────────────────────────────────

describe('resolveWorkspaceId', () => {
  it('resolves an exact worktree path', () => {
    registerWorktreePath('/Users/me/worktrees/feature-a', WS)
    expect(resolveWorkspaceId('/Users/me/worktrees/feature-a')).toBe(WS)
  })

  it('resolves a cwd nested below a registered worktree', () => {
    registerWorktreePath('/Users/me/worktrees/feature-a', WS)
    expect(resolveWorkspaceId('/Users/me/worktrees/feature-a/apps/desktop/src')).toBe(WS)
  })

  it('does not match a sibling path sharing a name prefix', () => {
    registerWorktreePath('/Users/me/worktrees/feature-a', WS)
    expect(resolveWorkspaceId('/Users/me/worktrees/feature-antique')).toBeNull()
  })

  it('does not match a parent of a registered worktree', () => {
    registerWorktreePath('/Users/me/worktrees/feature-a', WS)
    expect(resolveWorkspaceId('/Users/me/worktrees')).toBeNull()
  })

  it('keeps distinct worktrees mapped to their own workspaces', () => {
    registerWorktreePath('/Users/me/worktrees/feature-a', WS)
    registerWorktreePath('/Users/me/worktrees/feature-b', OTHER_WS)

    expect(resolveWorkspaceId('/Users/me/worktrees/feature-b/src')).toBe(OTHER_WS)
  })

  it('returns null when nothing is registered', () => {
    expect(resolveWorkspaceId('/tmp/anywhere')).toBeNull()
  })

  it('re-registering a path overwrites the previous workspace', () => {
    registerWorktreePath('/Users/me/worktrees/feature-a', WS)
    registerWorktreePath('/Users/me/worktrees/feature-a', OTHER_WS)

    expect(resolveWorkspaceId('/Users/me/worktrees/feature-a')).toBe(OTHER_WS)
  })
})

describe('unregisterWorktreePaths', () => {
  it('removes every path belonging to a workspace', () => {
    registerWorktreePath('/Users/me/worktrees/feature-a', WS)
    registerWorktreePath('/Users/me/worktrees/feature-a-repo2', WS)
    registerWorktreePath('/Users/me/worktrees/feature-b', OTHER_WS)

    unregisterWorktreePaths(WS)

    expect(resolveWorkspaceId('/Users/me/worktrees/feature-a')).toBeNull()
    expect(resolveWorkspaceId('/Users/me/worktrees/feature-a-repo2')).toBeNull()
    expect(resolveWorkspaceId('/Users/me/worktrees/feature-b')).toBe(OTHER_WS)
  })

  it('is a no-op for an unknown workspace', () => {
    registerWorktreePath('/Users/me/worktrees/feature-a', WS)

    unregisterWorktreePaths('nope')

    expect(resolveWorkspaceId('/Users/me/worktrees/feature-a')).toBe(WS)
  })
})

// ─── clearAllTerminalState ──────────────────────────────────────────────────

describe('clearAllTerminalState', () => {
  it('empties the store and the worktree map', () => {
    spawn('t1')
    spawn('t2', { workspaceId: OTHER_WS })
    registerWorktreePath('/Users/me/worktrees/feature-a', WS)

    clearAllTerminalState()

    expect(terminalStore.size).toBe(0)
    expect(resolveWorkspaceId('/Users/me/worktrees/feature-a')).toBeNull()
  })

  it('cancels every pending timer', () => {
    spawn('t1')
    handleCommandDetected('t1', 'claude', true)
    handleOutputActivity('t1')
    spawn('t2', { workspaceId: OTHER_WS })
    handleTerminalExited('t2', 0, OTHER_WS)

    clearAllTerminalState()
    vi.advanceTimersByTime(DISMISS_MS + SILENCE_MS)

    expect(terminalStore.size).toBe(0)
  })
})

// ─── Full lifecycle ─────────────────────────────────────────────────────────

describe('interactive agent lifecycle', () => {
  it('walks idle → running → idle → completed → dismissed', () => {
    spawn('t1')
    expect(entryOf('t1').status).toBe('idle')

    handleCommandDetected('t1', 'claude', true)
    expect(entryOf('t1').status).toBe('idle')

    handleOutputActivity('t1')
    expect(entryOf('t1').status).toBe('running')

    // Agent stops streaming: it is waiting on the user.
    vi.advanceTimersByTime(SILENCE_MS)
    expect(entryOf('t1').status).toBe('idle')

    // More output resumes running without a new command detection.
    handleOutputActivity('t1')
    expect(entryOf('t1').status).toBe('running')

    handleFgReturnedToShell('t1', WS)
    expect(entryOf('t1').status).toBe('completed')

    vi.advanceTimersByTime(DISMISS_MS)
    expect(entryOf('t1').status).toBe('idle')
    expect(entryOf('t1').command).toBeNull()
  })
})
