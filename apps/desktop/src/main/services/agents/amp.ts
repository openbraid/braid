// ─── Amp (Sourcegraph) agent ─────────────────────────────────────────────────
// Amp reads AGENTS.md at repo root. We generate AGENTS.md since we own the worktree.

import { join } from 'path'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import type { AgentDefinition, DiscoveredSession } from './types'

export const amp: AgentDefinition = {
  id: 'amp',
  displayName: 'Amp',
  detectCommand: 'amp',
  launchWithPrompt: (p) => `echo ${p} | amp --dangerously-allow-all`,

  async discoverSessions(): Promise<DiscoveredSession[]> {
    return []
  },

  async writeInstruction(workspaceRoot: string, content: string): Promise<void> {
    const agentsMdPath = join(workspaceRoot, 'AGENTS.md')

    if (existsSync(agentsMdPath)) {
      const existing = readFileSync(agentsMdPath, 'utf-8')
      if (existing.includes('# Braid Workspace Instructions')) return
      writeFileSync(agentsMdPath, existing.trimEnd() + '\n\n' + content + '\n', 'utf-8')
    } else {
      writeFileSync(agentsMdPath, content, 'utf-8')
    }
  },
}
