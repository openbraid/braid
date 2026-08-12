// ─── Goose agent ─────────────────────────────────────────────────────────────

import { join } from 'path'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import type { AgentDefinition, DiscoveredSession } from './types'

export const goose: AgentDefinition = {
  id: 'goose',
  displayName: 'Goose',
  detectCommand: 'goose',
  launchWithPrompt: (p) => `GOOSE_MODE=auto goose ${p}`,

  async discoverSessions(): Promise<DiscoveredSession[]> {
    return []
  },

  async writeInstruction(workspaceRoot: string, content: string): Promise<void> {
    const hintsPath = join(workspaceRoot, '.goosehints')

    if (existsSync(hintsPath)) {
      const existing = readFileSync(hintsPath, 'utf-8')
      if (existing.includes('# Braid Workspace Instructions')) return
      writeFileSync(hintsPath, existing.trimEnd() + '\n\n' + content + '\n', 'utf-8')
    } else {
      writeFileSync(hintsPath, content, 'utf-8')
    }
  },
}
