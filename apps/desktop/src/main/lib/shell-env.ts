// ─── Shell Environment Resolver ──────────────────────────────────────────────
//
// Packaged Electron apps don't inherit the user's login shell PATH.
// Commands like `which claude` or `npm install` fail because tools installed
// via homebrew, nvm, etc. aren't on the minimal system PATH.
//
// This module resolves the user's full login shell environment once at startup
// and exposes it for all child process spawns.

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

let resolvedEnv: Record<string, string> | null = null

/**
 * Resolve the user's login shell environment.
 * Spawns a login shell, prints env, and parses the output.
 * Result is cached — safe to call multiple times.
 */
export async function resolveShellEnv(): Promise<Record<string, string>> {
  if (resolvedEnv) return resolvedEnv

  const shell = process.env.SHELL || '/bin/zsh'

  try {
    const { stdout } = await execFileAsync(shell, ['-l', '-c', 'env'], {
      timeout: 5000,
      env: { HOME: process.env.HOME, USER: process.env.USER, SHELL: shell }
    })

    const env: Record<string, string> = {}
    for (const line of stdout.split('\n')) {
      const eqIndex = line.indexOf('=')
      if (eqIndex > 0) {
        env[line.slice(0, eqIndex)] = line.slice(eqIndex + 1)
      }
    }

    // Ensure critical vars are always present
    if (!env.HOME) env.HOME = process.env.HOME || ''
    if (!env.USER) env.USER = process.env.USER || ''
    if (!env.SHELL) env.SHELL = shell

    resolvedEnv = env
    return env
  } catch {
    // Fallback to process.env if shell resolution fails
    resolvedEnv = process.env as Record<string, string>
    return resolvedEnv
  }
}

/**
 * Get the cached shell env. Returns process.env if not yet resolved.
 * Prefer `resolveShellEnv()` (async) when possible.
 */
export function getShellEnv(): Record<string, string> {
  return resolvedEnv ?? (process.env as Record<string, string>)
}
