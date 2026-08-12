// ─── Qwen Code session provider ──────────────────────────────────────────────
// Same path-encoding as Claude: ~/.qwen/projects/<path-encoded>/chats/*.jsonl

import { homedir } from 'os'
import { join } from 'path'
import { readdir, stat } from 'fs/promises'
import type { DiscoveredSession, AgentSessionProvider } from '../types'
import { toClaudeStyleDirName, prefixMatchDirs, readFirstLines } from '../lib'

const QWEN_PROJECTS_DIR = join(homedir(), '.qwen', 'projects')

async function parseFirstUserMessage(filePath: string): Promise<string | null> {
  const lines = await readFirstLines(filePath, 10)
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'user' && obj.message?.role === 'user') {
        const parts = obj.message.parts
        if (Array.isArray(parts)) {
          const text = parts.find((p: { text?: string }) => p.text)
          if (text?.text) return text.text.slice(0, 200)
        }
      }
    } catch { /* skip */ }
  }
  return null
}

export const qwenProvider: AgentSessionProvider = {
  agent: 'Qwen Code',

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    const prefixes = worktreePaths.map(toClaudeStyleDirName)
    const matchingDirs = await prefixMatchDirs(QWEN_PROJECTS_DIR, prefixes)

    const sessions: DiscoveredSession[] = []

    for (const dir of matchingDirs) {
      const chatsDir = join(QWEN_PROJECTS_DIR, dir, 'chats')
      let files: string[]
      try { files = await readdir(chatsDir) } catch { continue }

      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'))

      for (const file of jsonlFiles) {
        const sessionId = file.replace('.jsonl', '')
        const filePath = join(chatsDir, file)
        try {
          const fileStat = await stat(filePath)
          const title = await parseFirstUserMessage(filePath)
          sessions.push({
            sessionId,
            agent: 'Qwen Code',
            title,
            lastUpdated: fileStat.mtimeMs,
            resumeCommand: `qwen-code --resume ${sessionId}`,
            directory: dir,
          })
        } catch { /* skip */ }
      }
    }

    return sessions
  },
}
