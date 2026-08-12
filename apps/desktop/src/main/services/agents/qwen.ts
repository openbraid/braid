// ─── Qwen Code agent ─────────────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import type { AgentDefinition, DiscoveredSession } from './types'
import { toClaudeStyleDirName, prefixMatchDirs, readFirstLines } from '../sessions/lib'

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

export const qwen: AgentDefinition = {
  id: 'qwen',
  displayName: 'Qwen Code',
  detectCommand: 'qwen',
  launchWithPrompt: (p) => `qwen -y -i ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    const prefixes = worktreePaths.map(toClaudeStyleDirName)
    const matchingDirs = await prefixMatchDirs(QWEN_PROJECTS_DIR, prefixes)
    const sessions: DiscoveredSession[] = []

    for (const dir of matchingDirs) {
      const chatsDir = join(QWEN_PROJECTS_DIR, dir, 'chats')
      let files: string[]
      try { files = await readdir(chatsDir) } catch { continue }

      for (const file of files.filter((f) => f.endsWith('.jsonl'))) {
        const sessionId = file.replace('.jsonl', '')
        const filePath = join(chatsDir, file)
        try {
          const fileStat = await stat(filePath)
          const title = await parseFirstUserMessage(filePath)
          sessions.push({
            sessionId, agent: 'Qwen Code', title,
            lastUpdated: fileStat.mtimeMs,
            resumeCommand: `qwen-code --resume ${sessionId}`,
            directory: dir,
          })
        } catch { /* skip */ }
      }
    }
    return sessions
  },

  async writeInstruction(workspaceRoot: string, content: string, braidDir: string): Promise<void> {
    // Write canonical file that QWEN.md imports
    writeFileSync(join(braidDir, 'agent_instruction.md'), content, 'utf-8')

    // Qwen supports @path import
    const qwenMdPath = join(workspaceRoot, 'QWEN.md')
    const importInstruction = '@.braid/agent_instruction.md'
    const importWorkspace = '@.braid/workspace.local.md'

    if (existsSync(qwenMdPath)) {
      let existing = readFileSync(qwenMdPath, 'utf-8')
      let changed = false
      if (!existing.includes(importInstruction)) {
        existing = existing.trimEnd() + '\n\n' + importInstruction
        changed = true
      }
      if (!existing.includes(importWorkspace)) {
        existing = existing.trimEnd() + '\n' + importWorkspace
        changed = true
      }
      if (changed) writeFileSync(qwenMdPath, existing + '\n', 'utf-8')
    } else {
      writeFileSync(qwenMdPath, importInstruction + '\n' + importWorkspace + '\n', 'utf-8')
    }
  },
}
