// ─── Kiro CLI agent ──────────────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import type { AgentDefinition, DiscoveredSession } from './types'

const SESSIONS_DIR = join(homedir(), '.kiro', 'sessions', 'cli')

interface KiroSession {
  session_id: string
  cwd: string
  title: string | null
  created_at: string
  updated_at: string
}

export const kiro: AgentDefinition = {
  id: 'kiro',
  displayName: 'Kiro',
  detectCommand: 'kiro-cli',
  launchWithPrompt: (p) => `kiro-cli chat --trust-all-tools ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    if (!existsSync(SESSIONS_DIR)) return []

    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'))
    const sessions: DiscoveredSession[] = []

    for (const file of files) {
      try {
        const raw = readFileSync(join(SESSIONS_DIR, file), 'utf-8')
        const data = JSON.parse(raw) as KiroSession
        if (!data.session_id || !data.cwd) continue
        if (!worktreePaths.some((wt) => data.cwd === wt || data.cwd.startsWith(wt + '/'))) continue

        sessions.push({
          sessionId: data.session_id,
          agent: 'Kiro CLI',
          title: data.title ?? null,
          lastUpdated: new Date(data.updated_at).getTime(),
          resumeCommand: `kiro-cli chat --resume ${data.session_id}`,
          directory: data.cwd,
        })
      } catch { /* skip malformed files */ }
    }

    return sessions.sort((a, b) => b.lastUpdated - a.lastUpdated)
  },

  async writeInstruction(workspaceRoot: string, content: string): Promise<void> {
    const dir = join(workspaceRoot, '.kiro', 'steering')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'braid.md'), content, 'utf-8')
  },
}
