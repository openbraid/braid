// ─── Cursor agent ────────────────────────────────────────────────────────────

import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import type { AgentDefinition, DiscoveredSession } from './types'

export const cursor: AgentDefinition = {
  id: 'cursor',
  displayName: 'Cursor',
  detectCommand: 'cursor-agent',
  launchWithPrompt: (p) => `cursor-agent --force ${p}`,

  async discoverSessions(): Promise<DiscoveredSession[]> {
    return [] // Cursor stores sessions in its own format — not yet implemented
  },

  async writeInstruction(workspaceRoot: string, content: string): Promise<void> {
    const dir = join(workspaceRoot, '.cursor', 'rules')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'braid.mdc'), content, 'utf-8')
  },
}
