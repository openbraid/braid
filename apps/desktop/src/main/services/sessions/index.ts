// ─── Session discovery service ───────────────────────────────────────────────
// Aggregates sessions from all registered agents, merges with user renames.

import type { AgentSession } from '../../../shared/ipc-types'
import { deriveWorktreePath } from '../../lib/derive-paths'
import { projectRepo, workspaceRepo, workspaceRepoRepo } from '../../repositories'
import { resolveIsMultiRepo } from '../worktree'
import { getSessionNamesBatch, upsertSessionName } from '../../db/queries/session-names'
import { AGENTS } from '../agents/registry'

export async function listSessions(workspaceId: string): Promise<AgentSession[]> {
  const workspace = await workspaceRepo.getById(workspaceId)
  if (!workspace) return []

  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) return []

  const repos = await workspaceRepoRepo.getReposByWorkspace(workspaceId)
  const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)

  const worktreePaths = repos.map((repo) =>
    deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo)
  )

  if (worktreePaths.length === 0) return []

  // Run all agents in parallel
  const results = await Promise.all(
    AGENTS.map((a) =>
      a.discoverSessions(worktreePaths).catch(() => [])
    )
  )

  const discovered = results.flat()
  if (discovered.length === 0) return []

  // Batch-fetch renames from our DB
  const keys = discovered.map((s) => ({ sessionId: s.sessionId, agent: s.agent }))
  const renames = getSessionNamesBatch(keys)

  // Merge and sort
  return discovered
    .map((s) => ({
      ...s,
      customName: renames.get(`${s.sessionId}::${s.agent}`) ?? null,
    }))
    .sort((a, b) => b.lastUpdated - a.lastUpdated)
}

export function renameSession(sessionId: string, agent: string, name: string): void {
  upsertSessionName(sessionId, agent, name)
}
