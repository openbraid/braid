// ─── Codex agent ─────────────────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readdirSync, writeFileSync, readFileSync } from 'fs'
import { stat } from 'fs/promises'
import type { AgentDefinition, DiscoveredSession } from './types'
import { readFirstLines } from '../sessions/lib'

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
                if (file.endsWith('.jsonl')) files.push(join(dayPath, file))
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return files
}

export const codex: AgentDefinition = {
  id: 'codex',
  displayName: 'Codex',
  detectCommand: 'codex',
  launchWithPrompt: (p) => `codex --full-auto ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    const allFiles = collectJsonlFiles(CODEX_SESSIONS_DIR)
    const sessions: DiscoveredSession[] = []

    for (const filePath of allFiles) {
      const meta = await parseLightweight(filePath)
      if (!meta.cwd || !meta.sessionId) continue
      const matches = worktreePaths.some((wt) => meta.cwd! === wt || meta.cwd!.startsWith(wt + '/'))
      if (!matches) continue

      try {
        const fileStat = await stat(filePath)
        sessions.push({
          sessionId: meta.sessionId, agent: 'Codex',
          title: meta.firstUserMessage,
          lastUpdated: fileStat.mtimeMs,
          resumeCommand: `codex resume ${meta.sessionId}`,
          directory: meta.cwd,
        })
      } catch { /* skip */ }
    }
    return sessions
  },

  async writeInstruction(workspaceRoot: string, content: string): Promise<void> {
    const agentsMdPath = join(workspaceRoot, 'AGENTS.md')

    if (existsSync(agentsMdPath)) {
      const existing = readFileSync(agentsMdPath, 'utf-8')
      if (existing.includes('# Braid Workspace Instructions')) return // already appended
      writeFileSync(agentsMdPath, existing.trimEnd() + '\n\n' + content + '\n', 'utf-8')
    } else {
      writeFileSync(agentsMdPath, content, 'utf-8')
    }
  },
}
