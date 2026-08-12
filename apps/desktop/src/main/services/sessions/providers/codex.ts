// ─── Codex CLI session provider ──────────────────────────────────────────────
// Sessions stored at ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// CWD is in the first line (session_meta.payload.cwd)

import { homedir } from 'os'
import { join } from 'path'
import { stat } from 'fs/promises'
import { readdirSync, existsSync } from 'fs'
import type { DiscoveredSession, AgentSessionProvider } from '../types'
import { readFirstLines } from '../lib'

const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions')

interface ParsedMeta {
  cwd: string | null
  sessionId: string | null
  firstUserMessage: string | null
}

async function parseLightweight(filePath: string): Promise<ParsedMeta> {
  const result: ParsedMeta = { cwd: null, sessionId: null, firstUserMessage: null }
  const lines = await readFirstLines(filePath, 30)

  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj.type === 'session_meta' && obj.payload) {
        result.cwd = obj.payload.cwd ?? null
        result.sessionId = obj.payload.id ?? null
      }
      // Codex stores user messages as response_item with payload.role='user'
      // Earlier entries are system prompts (AGENTS.md, permissions) — skip those
      if (!result.firstUserMessage && obj.type === 'response_item' && obj.payload?.role === 'user') {
        const content = obj.payload.content
        if (Array.isArray(content)) {
          const text = content.find((p: { type?: string }) => p.type === 'input_text')
          if (text?.text && !text.text.startsWith('<') && !text.text.startsWith('#')) {
            result.firstUserMessage = text.text.slice(0, 200)
          }
        }
      }
      if (result.cwd && result.sessionId && result.firstUserMessage) break
    } catch { /* skip */ }
  }

  return result
}

function collectJsonlFiles(dir: string): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files

  // Walk YYYY/MM/DD structure
  for (const year of readdirSync(dir)) {
    const yearPath = join(dir, year)
    try {
      for (const month of readdirSync(yearPath)) {
        const monthPath = join(yearPath, month)
        try {
          for (const day of readdirSync(monthPath)) {
            const dayPath = join(monthPath, day)
            try {
              for (const file of readdirSync(dayPath)) {
                if (file.endsWith('.jsonl')) {
                  files.push(join(dayPath, file))
                }
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return files
}

export const codexProvider: AgentSessionProvider = {
  agent: 'Codex',

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    const allFiles = collectJsonlFiles(CODEX_SESSIONS_DIR)
    const sessions: DiscoveredSession[] = []

    for (const filePath of allFiles) {
      const meta = await parseLightweight(filePath)
      if (!meta.cwd || !meta.sessionId) continue

      // Check if this session's cwd matches any of our worktree paths (prefix match)
      const matches = worktreePaths.some((wt) => meta.cwd!.startsWith(wt))
      if (!matches) continue

      try {
        const fileStat = await stat(filePath)
        sessions.push({
          sessionId: meta.sessionId,
          agent: 'Codex',
          title: meta.firstUserMessage,
          lastUpdated: fileStat.mtimeMs,
          resumeCommand: `codex resume ${meta.sessionId}`,
          directory: meta.cwd,
        })
      } catch { /* skip */ }
    }

    return sessions
  },
}
