// ─── Claude Code agent ───────────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { readdir, stat, open } from 'fs/promises'
import { mkdirSync, writeFileSync } from 'fs'
import type { AgentDefinition, DiscoveredSession } from './types'
import { toClaudeStyleDirName, prefixMatchDirs } from '../sessions/lib'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

async function parseFirstUserMessage(filePath: string): Promise<string | null> {
  let fh
  try {
    fh = await open(filePath, 'r')
    const stream = fh.readLines()
    for await (const line of stream) {
      try {
        const obj = JSON.parse(line)
        if (obj.type === 'user' && obj.message?.role === 'user') {
          const content = obj.message.content
          if (typeof content === 'string') return content.slice(0, 200)
          if (Array.isArray(content)) {
            const text = content.find((p: { type?: string }) => p.type === 'text')
            if (text?.text) return text.text.slice(0, 200)
          }
          if (Array.isArray(content) && content[0]?.type === 'tool_result') continue
          return null
        }
      } catch { /* skip */ }
    }
  } catch { /* file read error */ }
  finally { await fh?.close() }
  return null
}

export const claude: AgentDefinition = {
  id: 'claude',
  displayName: 'Claude Code',
  detectCommand: 'claude',
  launchWithPrompt: (p) => `claude --dangerously-skip-permissions ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    const prefixes = worktreePaths.map(toClaudeStyleDirName)
    const matchingDirs = await prefixMatchDirs(CLAUDE_PROJECTS_DIR, prefixes)
    const sessions: DiscoveredSession[] = []

    for (const dir of matchingDirs) {
      const dirPath = join(CLAUDE_PROJECTS_DIR, dir)
      let files: string[]
      try { files = await readdir(dirPath) } catch { continue }

      for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
        const sessionId = file.replace('.jsonl', '')
        const filePath = join(dirPath, file)
        try {
          const fileStat = await stat(filePath)
          const title = await parseFirstUserMessage(filePath)
          sessions.push({
            sessionId, agent: 'Claude Code', title,
            lastUpdated: fileStat.mtimeMs,
            resumeCommand: `claude --resume ${sessionId}`,
            directory: dir,
          })
        } catch { /* skip */ }
      }
    }
    return sessions
  },

  async writeInstruction(workspaceRoot: string, content: string): Promise<void> {
    const dir = join(workspaceRoot, '.claude', 'rules')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'braid.md'), content, 'utf-8')
  },
}
