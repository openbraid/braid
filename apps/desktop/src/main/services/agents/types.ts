// ─── Unified Agent Definition ────────────────────────────────────────────────
// Each AI coding agent implements this interface. One place for all agent
// capabilities: session discovery, instruction injection, detection.

export interface DiscoveredSession {
  sessionId: string
  agent: string
  title: string | null
  lastUpdated: number
  resumeCommand: string | null
  directory: string
}

export interface AgentDefinition {
  /** Unique identifier used in project settings (e.g. 'claude', 'codex') */
  id: string
  /** Display name for UI (e.g. 'Claude Code', 'Codex') */
  displayName: string
  /** CLI command to check if installed via `which` */
  detectCommand: string

  /** Discover past sessions for this agent in the given worktree paths */
  discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]>

  /** Write instruction file for this agent into the workspace. No-op if not supported.
   *  @param braidDir - The .braid/ directory, for agents that need to write the canonical file there. */
  writeInstruction(workspaceRoot: string, instructionContent: string, braidDir: string): Promise<void>

  /** Build a shell command that launches this agent with an initial prompt.
   *  Returns the full command string (prompt already escaped).
   *  Undefined if the agent doesn't support CLI launch with a prompt. */
  launchWithPrompt?: (escapedPrompt: string) => string
}
