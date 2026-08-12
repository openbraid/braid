// ─── OpenCode session provider ───────────────────────────────────────────────
// Sessions in SQLite at ~/.local/share/opencode/opencode.db
// Table: session (id, directory, title, time_created, time_updated)

import { homedir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import type { DiscoveredSession, AgentSessionProvider } from '../types'

const OPENCODE_DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

export const opencodeProvider: AgentSessionProvider = {
  agent: 'OpenCode',

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    if (!existsSync(OPENCODE_DB_PATH)) return []

    let db: Database.Database
    try {
      db = new Database(OPENCODE_DB_PATH, { readonly: true })
    } catch { return [] }

    try {
      // Get sessions
      const rows = db.prepare(
        'SELECT id, directory, title, time_created, time_updated FROM session ORDER BY time_updated DESC'
      ).all() as Array<{
        id: string
        directory: string
        title: string
        time_created: number
        time_updated: number
      }>

      // Get first user message per session from part table
      // message.data has {"role":"user"}, part.data has {"type":"text","text":"..."}
      const firstUserMsgStmt = db.prepare(`
        SELECT p.data FROM part p
        JOIN message m ON p.message_id = m.id
        WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'user'
        ORDER BY m.time_created ASC, p.id ASC
        LIMIT 1
      `)

      return rows
        .filter((row) => worktreePaths.some((wt) => row.directory.startsWith(wt)))
        .map((row) => {
          let title: string | null = null
          try {
            const part = firstUserMsgStmt.get(row.id) as { data: string } | undefined
            if (part) {
              const parsed = JSON.parse(part.data)
              if (parsed.type === 'text' && parsed.text) {
                title = parsed.text.slice(0, 200)
              }
            }
          } catch { /* fall back to DB title */ }

          return {
            sessionId: row.id,
            agent: 'OpenCode',
            title: title || row.title || null,
            lastUpdated: row.time_updated,
            resumeCommand: `opencode --session ${row.id}`,
            directory: row.directory,
          }
        })
    } catch { return [] }
    finally { db.close() }
  },
}
