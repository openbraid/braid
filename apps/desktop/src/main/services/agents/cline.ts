// ─── Cline agent ─────────────────────────────────────────────────────────────

import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import type { AgentDefinition, DiscoveredSession } from './types'

const CLINE_TASK_HISTORY = join(homedir(), '.cline', 'data', 'state', 'taskHistory.json')

interface ClineHistoryItem {
  id: string
  task: string
  ts: number
  cwdOnTaskInitialization: string
}

export const cline: AgentDefinition = {
  id: 'cline',
  displayName: 'Cline',
  detectCommand: 'cline',
  launchWithPrompt: (p) => `cline --auto-approve-all ${p}`,

  async discoverSessions(worktreePaths: string[]): Promise<DiscoveredSession[]> {
    let raw: string
    try { raw = await readFile(CLINE_TASK_HISTORY, 'utf-8') } catch { return [] }

    let items: ClineHistoryItem[]
    try { items = JSON.parse(raw) } catch { return [] }

    return items
      .filter((item) => {
        const cwd = item.cwdOnTaskInitialization
        return cwd && worktreePaths.some((wt) => cwd === wt || cwd.startsWith(wt + '/'))
      })
      .map((item) => ({
        sessionId: item.id,
        agent: 'Cline',
        title: item.task?.slice(0, 200) ?? null,
        lastUpdated: item.ts,
        resumeCommand: `cline -T ${item.id}`,
        directory: item.cwdOnTaskInitialization,
      }))
  },

  async writeInstruction(workspaceRoot: string, content: string): Promise<void> {
    const dir = join(workspaceRoot, '.clinerules')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'braid.md'), content, 'utf-8')
  },
}
