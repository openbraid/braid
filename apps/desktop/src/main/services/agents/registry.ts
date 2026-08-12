// ─── Agent Registry ──────────────────────────────────────────────────────────
// Single source of truth for all supported AI coding agents.
// Session discovery, instruction injection, and detection all use this registry.

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AgentDefinition } from './types'
import { resolveShellEnv } from '../../lib/shell-env'

import { claude } from './claude'
import { codex } from './codex'
import { copilot } from './copilot'
import { cursor } from './cursor'
import { cline } from './cline'
import { gemini } from './gemini'
import { aider } from './aider'
import { goose } from './goose'
import { amp } from './amp'
import { kiro } from './kiro'
import { opencode } from './opencode'
import { factory } from './factory'
import { qwen } from './qwen'
import { vibe } from './vibe'

const execFileAsync = promisify(execFile)

/** All registered agents. Add new agents here — they automatically appear in
 *  session discovery, instruction injection, detection, and settings UI. */
export const AGENTS: AgentDefinition[] = [
  claude,
  codex,
  copilot,
  cursor,
  cline,
  gemini,
  aider,
  goose,
  amp,
  kiro,
  opencode,
  factory,
  qwen,
  vibe,
]

export function getAgentById(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id)
}

/** Returns agent info for all agents. Used by the settings UI. */
export function getAgentList(): Array<{ id: string; displayName: string; supportsLaunch: boolean }> {
  return AGENTS.map((a) => ({ id: a.id, displayName: a.displayName, supportsLaunch: !!a.launchWithPrompt }))
}

/** Detect which agent CLIs are installed on this machine. */
export async function detectInstalledAgents(): Promise<string[]> {
  const env = await resolveShellEnv()
  const results = await Promise.all(
    AGENTS.map(async (agent) => {
      try {
        await execFileAsync('which', [agent.detectCommand], { env })
        return agent.id
      } catch {
        return null
      }
    })
  )
  return results.filter((id): id is string => id !== null)
}
