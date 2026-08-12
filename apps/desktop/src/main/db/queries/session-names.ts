// ─── Session name queries ────────────────────────────────────────────────────
// Stores user-assigned names for agent sessions (renames).
// Only renamed sessions have rows here — discovered sessions are not stored.

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../index'
import { sessionNames } from '../schema'

export function getSessionName(sessionId: string, agent: string): string | null {
  const row = db
    .select({ name: sessionNames.name })
    .from(sessionNames)
    .where(and(eq(sessionNames.sessionId, sessionId), eq(sessionNames.agent, agent)))
    .get()
  return row?.name ?? null
}

export function getSessionNamesBatch(
  keys: Array<{ sessionId: string; agent: string }>
): Map<string, string> {
  if (keys.length === 0) return new Map()

  const sessionIds = keys.map((k) => k.sessionId)
  const rows = db
    .select()
    .from(sessionNames)
    .where(inArray(sessionNames.sessionId, sessionIds))
    .all()

  const map = new Map<string, string>()
  for (const row of rows) {
    map.set(`${row.sessionId}::${row.agent}`, row.name)
  }
  return map
}

export function upsertSessionName(sessionId: string, agent: string, name: string): void {
  db.insert(sessionNames)
    .values({ sessionId, agent, name, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: [sessionNames.sessionId, sessionNames.agent],
      set: { name, updatedAt: Date.now() },
    })
    .run()
}

export function deleteSessionName(sessionId: string, agent: string): void {
  db.delete(sessionNames)
    .where(and(eq(sessionNames.sessionId, sessionId), eq(sessionNames.agent, agent)))
    .run()
}
