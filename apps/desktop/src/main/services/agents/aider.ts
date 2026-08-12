// ─── Aider agent ─────────────────────────────────────────────────────────────

import { join } from 'path'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import type { AgentDefinition, DiscoveredSession } from './types'

export const aider: AgentDefinition = {
  id: 'aider',
  displayName: 'Aider',
  detectCommand: 'aider',
  launchWithPrompt: (p) => `aider --yes-always -m ${p}`,

  async discoverSessions(): Promise<DiscoveredSession[]> {
    return []
  },

  async writeInstruction(workspaceRoot: string, content: string, braidDir: string): Promise<void> {
    // Write canonical file that config points to
    writeFileSync(join(braidDir, 'agent_instruction.md'), content, 'utf-8')

    // Aider uses .aider.conf.yml with read: directive
    const configPath = join(workspaceRoot, '.aider.conf.yml')
    const readLine = 'read: [.braid/agent_instruction.md, .braid/workspace.local.md]'

    if (existsSync(configPath)) {
      const existing = readFileSync(configPath, 'utf-8')
      if (existing.includes('.braid/agent_instruction.md')) return
      writeFileSync(configPath, existing.trimEnd() + '\n' + readLine + '\n', 'utf-8')
    } else {
      writeFileSync(configPath, readLine + '\n', 'utf-8')
    }
  },
}
