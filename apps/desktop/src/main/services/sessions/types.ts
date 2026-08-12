// ─── Agent session provider interface ────────────────────────────────────────
// Each AI agent (Claude, Codex, etc.) implements this to discover local sessions.

/** Raw session data returned by a provider (before rename merge). */
export interface DiscoveredSession {
  sessionId: string
  agent: string
  title: string | null
  lastUpdated: number
  resumeCommand: string | null
  directory: string
}

export interface AgentSessionProvider {
  agent: string
  discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]>
}
