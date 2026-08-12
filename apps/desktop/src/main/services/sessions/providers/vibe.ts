// ─── Vibe (Mistral) session provider ─────────────────────────────────────────
// Sessions at ~/.vibe/logs/session/session_<timestamp>_<id>/
// CWD in meta.json → environment.working_directory

import { homedir } from 'os'
import { join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import type { DiscoveredSession, AgentSessionProvider } from '../types'

const VIBE_SESSIONS_DIR = join(homedir(), '.vibe', 'logs', 'session')

export const vibeProvider: AgentSessionProvider = {
  agent: 'Vibe',

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

        const matches = worktreePaths.some((wt) => cwd.startsWith(wt))
        if (!matches) continue

        const sessionId = meta.session_id ?? dir
        const title = meta.title && meta.title !== 'Untitled' ? meta.title : null

        const dirStat = await stat(metaPath)
        sessions.push({
          sessionId,
          agent: 'Vibe',
          title,
          lastUpdated: dirStat.mtimeMs,
          resumeCommand: `vibe --resume ${sessionId}`,
          directory: cwd,
        })
      } catch { /* skip unreadable sessions */ }
    }

    return sessions
  },
}
