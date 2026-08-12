// ─── Factory Droid agent ─────────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import type { AgentDefinition, DiscoveredSession } from './types'
import { toClaudeStyleDirName, prefixMatchDirs, readFirstLines } from '../sessions/lib'

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

export const factory: AgentDefinition = {
  id: 'factory',
  displayName: 'Factory Droid',
  detectCommand: 'droid',
  launchWithPrompt: (p) => `droid ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    const prefixes = worktreePaths.map(toClaudeStyleDirName)
    const matchingDirs = await prefixMatchDirs(FACTORY_SESSIONS_DIR, prefixes)
    const sessions: DiscoveredSession[] = []

    for (const dir of matchingDirs) {
      const dirPath = join(FACTORY_SESSIONS_DIR, dir)
      let files: string[]
      try { files = await readdir(dirPath) } catch { continue }

      for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
        const sessionId = file.replace('.jsonl', '')
        const filePath = join(dirPath, file)
        try {
          const fileStat = await stat(filePath)
          const title = await parseFirstUserMessage(filePath)
          sessions.push({
            sessionId, agent: 'Factory Droid', title,
            lastUpdated: fileStat.mtimeMs,
            resumeCommand: `droid exec -s ${sessionId} "custom query"`,
            directory: dir,
          })
        } catch { /* skip */ }
      }
    }
    return sessions
  },

  async writeInstruction(workspaceRoot: string, content: string): Promise<void> {
    const agentsMdPath = join(workspaceRoot, 'AGENTS.md')

    if (existsSync(agentsMdPath)) {
      const existing = readFileSync(agentsMdPath, 'utf-8')
      if (existing.includes('# Braid Workspace Instructions')) return
      writeFileSync(agentsMdPath, existing.trimEnd() + '\n\n' + content + '\n', 'utf-8')
    } else {
      writeFileSync(agentsMdPath, content, 'utf-8')
    }
  },
}
