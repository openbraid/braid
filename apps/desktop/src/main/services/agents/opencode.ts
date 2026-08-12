// ─── OpenCode agent ──────────────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import Database from 'better-sqlite3'
import type { AgentDefinition, DiscoveredSession } from './types'

const OPENCODE_DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

export const opencode: AgentDefinition = {
  id: 'opencode',
  displayName: 'OpenCode',
  detectCommand: 'opencode',
  launchWithPrompt: (p) => `opencode --prompt ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    if (!existsSync(OPENCODE_DB_PATH)) return []

    let db: Database.Database
    try { db = new Database(OPENCODE_DB_PATH, { readonly: true }) } catch { return [] }

    try {
      const rows = db.prepare(
        'SELECT id, directory, title, time_created, time_updated FROM session ORDER BY time_updated DESC'
      ).all() as Array<{ id: string; directory: string; title: string; time_created: number; time_updated: number }>

      const firstUserMsgStmt = db.prepare(`
        SELECT p.data FROM part p
        JOIN message m ON p.message_id = m.id
        WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'user'
        ORDER BY m.time_created ASC, p.id ASC
        LIMIT 1
      `)

      return rows
        .filter((row) => worktreePaths.some((wt) => row.directory === wt || row.directory.startsWith(wt + '/')))
        .map((row) => {
          let title: string | null = null
          try {
            const part = firstUserMsgStmt.get(row.id) as { data: string } | undefined
            if (part) {
              const parsed = JSON.parse(part.data)
              if (parsed.type === 'text' && parsed.text) title = parsed.text.slice(0, 200)
            }
          } catch { /* fall back */ }

          return {
            sessionId: row.id, agent: 'OpenCode',
            title: title || row.title || null,
            lastUpdated: row.time_updated,
            resumeCommand: `opencode --session ${row.id}`,
            directory: row.directory,
          }
        })
    } catch { return [] }
    finally { db.close() }
  },

  async writeInstruction(workspaceRoot: string, content: string, braidDir: string): Promise<void> {
    // Write canonical file that config points to
    writeFileSync(join(braidDir, 'agent_instruction.md'), content, 'utf-8')

    // OpenCode uses opencode.json with instructions array
    const configPath = join(workspaceRoot, 'opencode.json')

    const targets = ['.braid/agent_instruction.md', '.braid/workspace.local.md']

    if (existsSync(configPath)) {
      try {
        const existing = JSON.parse(readFileSync(configPath, 'utf-8'))
        const instructions: string[] = existing.instructions ?? []
        const missing = targets.filter((t) => !instructions.includes(t))
        if (missing.length > 0) {
          existing.instructions = [...instructions, ...missing]
          writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
        }
      } catch { /* malformed config, skip */ }
    } else {
      writeFileSync(configPath, JSON.stringify({ instructions: targets }, null, 2) + '\n', 'utf-8')
    }
  },
}
