// ─── Factory Droid session provider ──────────────────────────────────────────
// Same path-encoding convention as Claude: ~/.factory/sessions/<path-encoded>/

import { homedir } from 'os'
import { join } from 'path'
import { readdir, stat } from 'fs/promises'
import type { DiscoveredSession, AgentSessionProvider } from '../types'
import { toClaudeStyleDirName, prefixMatchDirs, readFirstLines } from '../lib'

const FACTORY_SESSIONS_DIR = join(homedir(), '.factory', 'sessions')

async function parseFirstUserMessage(filePath: string): Promise<string | null> {
  const lines = await readFirstLines(filePath, 20)
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'message' && obj.message?.role === 'user') {
        const content = obj.message.content
        if (typeof content === 'string') return content.slice(0, 200)
        if (Array.isArray(content)) {
          const text = content.find((p: { type?: string }) => p.type === 'text')
          if (text?.text) return text.text.slice(0, 200)
        }
      }
    } catch { /* skip */ }
  }
  return null
}

export const factoryProvider: AgentSessionProvider = {
  agent: 'Factory Droid',

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    const prefixes = worktreePaths.map(toClaudeStyleDirName)
    const matchingDirs = await prefixMatchDirs(FACTORY_SESSIONS_DIR, prefixes)

    const sessions: DiscoveredSession[] = []

    for (const dir of matchingDirs) {
      const dirPath = join(FACTORY_SESSIONS_DIR, dir)
      let files: string[]
      try { files = await readdir(dirPath) } catch { continue }

      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'))

      for (const file of jsonlFiles) {
        const sessionId = file.replace('.jsonl', '')
        const filePath = join(dirPath, file)
        try {
          const fileStat = await stat(filePath)
          const title = await parseFirstUserMessage(filePath)
          sessions.push({
            sessionId,
            agent: 'Factory Droid',
            title,
            lastUpdated: fileStat.mtimeMs,
            resumeCommand: `droid exec -s ${sessionId} "custom query"`,
            directory: dir,
          })
        } catch { /* skip */ }
      }
    }

    return sessions
  },
}
