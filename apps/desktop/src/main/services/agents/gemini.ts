// ─── Gemini CLI agent ────────────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import type { AgentDefinition, DiscoveredSession } from './types'

const GEMINI_TMP_DIR = join(homedir(), '.gemini', 'tmp')

export const gemini: AgentDefinition = {
  id: 'gemini',
  displayName: 'Gemini CLI',
  detectCommand: 'gemini',
  launchWithPrompt: (p) => `gemini -y ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    let projectDirs: string[]
    try { projectDirs = await readdir(GEMINI_TMP_DIR) } catch { return [] }
    const sessions: DiscoveredSession[] = []

    for (const projectDir of projectDirs) {
      const projectRootPath = join(GEMINI_TMP_DIR, projectDir, '.project_root')
      let projectRoot: string
      try { projectRoot = (await readFile(projectRootPath, 'utf-8')).trim() } catch { continue }

      const matches = worktreePaths.some((wt) => projectRoot === wt || projectRoot.startsWith(wt + '/'))
      if (!matches) continue

      const chatsDir = join(GEMINI_TMP_DIR, projectDir, 'chats')
      let chatFiles: string[]
      try { chatFiles = await readdir(chatsDir) } catch { continue }

      for (const file of chatFiles.filter((f) => f.startsWith('session-') && f.endsWith('.json'))) {
        const filePath = join(chatsDir, file)
        try {
          const raw = await readFile(filePath, 'utf-8')
          const data = JSON.parse(raw)
          const sessionId = data.sessionId ?? file.replace('.json', '')

          let title: string | null = null
          for (const msg of data.messages ?? []) {
            if (msg.type === 'user') {
              const content = msg.content
              if (typeof content === 'string') title = content.slice(0, 200)
              else if (Array.isArray(content)) {
                const text = content.find((p: { text?: string }) => p.text)
                if (text?.text) title = text.text.slice(0, 200)
              }
              break
            }
          }

          const fileStat = await stat(filePath)
          sessions.push({
            sessionId, agent: 'Gemini CLI', title,
            lastUpdated: data.lastUpdated ? new Date(data.lastUpdated).getTime() : fileStat.mtimeMs,
            resumeCommand: `gemini --resume ${sessionId}`,
            directory: projectRoot,
          })
        } catch { /* skip */ }
      }
    }
    return sessions
  },

  async writeInstruction(workspaceRoot: string, content: string, braidDir: string): Promise<void> {
    // Write canonical file that GEMINI.md imports
    writeFileSync(join(braidDir, 'agent_instruction.md'), content, 'utf-8')

    // Gemini supports @path import — write a one-liner GEMINI.md that imports our file
    const geminiMdPath = join(workspaceRoot, 'GEMINI.md')
    const importInstruction = '@.braid/agent_instruction.md'
    const importWorkspace = '@.braid/workspace.local.md'

    if (existsSync(geminiMdPath)) {
      let existing = readFileSync(geminiMdPath, 'utf-8')
      let changed = false
      if (!existing.includes(importInstruction)) {
        existing = existing.trimEnd() + '\n\n' + importInstruction
        changed = true
      }
      if (!existing.includes(importWorkspace)) {
        existing = existing.trimEnd() + '\n' + importWorkspace
        changed = true
      }
      if (changed) writeFileSync(geminiMdPath, existing + '\n', 'utf-8')
    } else {
      writeFileSync(geminiMdPath, importInstruction + '\n' + importWorkspace + '\n', 'utf-8')
    }
  },
}
