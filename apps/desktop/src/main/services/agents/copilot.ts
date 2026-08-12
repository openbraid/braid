// ─── GitHub Copilot CLI agent ────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { mkdirSync, writeFileSync } from 'fs'
import type { AgentDefinition, DiscoveredSession } from './types'

const COPILOT_SESSIONS_DIR = join(homedir(), '.copilot', 'session-state')

function parseWorkspaceYaml(content: string): { id: string | null; cwd: string | null; updatedAt: string | null } {
  const result: { id: string | null; cwd: string | null; updatedAt: string | null } = { id: null, cwd: null, updatedAt: null }
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('id:')) result.id = trimmed.slice(3).trim()
    else if (trimmed.startsWith('cwd:')) result.cwd = trimmed.slice(4).trim()
    else if (trimmed.startsWith('updated_at:')) result.updatedAt = trimmed.slice(11).trim()
  }
  return result
}

export const copilot: AgentDefinition = {
  id: 'copilot',
  displayName: 'GitHub Copilot',
  detectCommand: 'gh',
  launchWithPrompt: (p) => `copilot --allow-all -i ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    let sessionDirs: string[]
    try { sessionDirs = await readdir(COPILOT_SESSIONS_DIR) } catch { return [] }
    const sessions: DiscoveredSession[] = []

    for (const dir of sessionDirs) {
      const yamlPath = join(COPILOT_SESSIONS_DIR, dir, 'workspace.yaml')
      try {
        const raw = await readFile(yamlPath, 'utf-8')
        const parsed = parseWorkspaceYaml(raw)
        if (!parsed.cwd) continue
        const matches = worktreePaths.some((wt) => parsed.cwd! === wt || parsed.cwd!.startsWith(wt + '/'))
        if (!matches) continue

        const sessionId = parsed.id ?? dir
        const dirStat = await stat(yamlPath)
        sessions.push({
          sessionId, agent: 'Copilot CLI', title: null,
          lastUpdated: parsed.updatedAt ? new Date(parsed.updatedAt).getTime() : dirStat.mtimeMs,
          resumeCommand: `copilot --resume=${sessionId}`,
          directory: parsed.cwd,
        })
      } catch { /* skip */ }
    }
    return sessions
  },

  async writeInstruction(workspaceRoot: string, content: string): Promise<void> {
    const dir = join(workspaceRoot, '.github', 'instructions')
    mkdirSync(dir, { recursive: true })
    const fileContent = `---\napplyTo: "**"\n---\n\n${content}`
    writeFileSync(join(dir, 'braid.instructions.md'), fileContent, 'utf-8')
  },
}
