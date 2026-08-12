// ─── Gemini CLI session provider ─────────────────────────────────────────────
// Sessions at ~/.gemini/tmp/<project-name>/chats/session-*.json
// CWD stored in .project_root file in the project directory

import { homedir } from 'os'
import { join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import type { DiscoveredSession, AgentSessionProvider } from '../types'

const GEMINI_TMP_DIR = join(homedir(), '.gemini', 'tmp')

export const geminiProvider: AgentSessionProvider = {
  agent: 'Gemini CLI',

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    let projectDirs: string[]
    try { projectDirs = await readdir(GEMINI_TMP_DIR) } catch { return [] }

    const sessions: DiscoveredSession[] = []

    for (const projectDir of projectDirs) {
      // Read .project_root to get the actual path
      const projectRootPath = join(GEMINI_TMP_DIR, projectDir, '.project_root')
      let projectRoot: string
      try {
        projectRoot = (await readFile(projectRootPath, 'utf-8')).trim()
      } catch { continue }

      // Check if this project matches any of our worktree paths
      const matches = worktreePaths.some((wt) =>
        projectRoot.startsWith(wt) || wt.startsWith(projectRoot)
      )
      if (!matches) continue

      // Scan chats directory
      const chatsDir = join(GEMINI_TMP_DIR, projectDir, 'chats')
      let chatFiles: string[]
      try { chatFiles = await readdir(chatsDir) } catch { continue }

      const sessionFiles = chatFiles.filter((f) => f.startsWith('session-') && f.endsWith('.json'))

      for (const file of sessionFiles) {
        const filePath = join(chatsDir, file)
        try {
          const raw = await readFile(filePath, 'utf-8')
          const data = JSON.parse(raw)

          const sessionId = data.sessionId ?? file.replace('.json', '')

          // Find first user message
          let title: string | null = null
          const messages = data.messages ?? []
          for (const msg of messages) {
            if (msg.type === 'user') {
              const content = msg.content
              if (typeof content === 'string') {
                title = content.slice(0, 200)
              } else if (Array.isArray(content)) {
                const text = content.find((p: { text?: string }) => p.text)
                if (text?.text) title = text.text.slice(0, 200)
              }
              break
            }
          }

          const fileStat = await stat(filePath)
          sessions.push({
            sessionId,
            agent: 'Gemini CLI',
            title,
            lastUpdated: data.lastUpdated ? new Date(data.lastUpdated).getTime() : fileStat.mtimeMs,
            resumeCommand: `gemini --resume ${sessionId}`,
            directory: projectRoot,
          })
        } catch { /* skip */ }
      }
    }

    return sessions
  },
}
