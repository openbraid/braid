// ─── Vibe (Mistral) agent ────────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import type { AgentDefinition, DiscoveredSession } from './types'

const VIBE_SESSIONS_DIR = join(homedir(), '.vibe', 'logs', 'session')

export const vibe: AgentDefinition = {
  id: 'vibe',
  displayName: 'Vibe',
  detectCommand: 'vibe',
  launchWithPrompt: (p) => `vibe --agent auto-approve ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    let sessionDirs: string[]
    try { sessionDirs = await readdir(VIBE_SESSIONS_DIR) } catch { return [] }
    const sessions: DiscoveredSession[] = []

    for (const dir of sessionDirs) {
      const metaPath = join(VIBE_SESSIONS_DIR, dir, 'meta.json')
      try {
        const raw = await readFile(metaPath, 'utf-8')
        const meta = JSON.parse(raw)
        const cwd = meta.environment?.working_directory
        if (!cwd) continue

        const matches = worktreePaths.some((wt) => cwd === wt || cwd.startsWith(wt + '/'))
        if (!matches) continue

        const sessionId = meta.session_id ?? dir
        const title = meta.title && meta.title !== 'Untitled' ? meta.title : null
        const dirStat = await stat(metaPath)
        sessions.push({
          sessionId, agent: 'Vibe', title,
          lastUpdated: dirStat.mtimeMs,
          resumeCommand: `vibe --resume ${sessionId}`,
          directory: cwd,
        })
      } catch { /* skip */ }
    }
    return sessions
  },

  async writeInstruction(): Promise<void> {
    // No instruction injection support
  },
}
