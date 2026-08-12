// ─── Workspace queries ───────────────────────────────────────────────────────
//
// Cloud-layer entities held in SQLite for local mode. Only LocalWorkspaceRepository
// and LocalWorkspaceRepoRepository call these.

import { eq, inArray } from 'drizzle-orm'
import { db } from '../index'
import { workspaces, workspaceRepos, repositories, projectRepositories } from '../schema'
import type { WorkspaceRow, RepositoryRow } from '../schema'
import type { WorkspaceLifecycleStatus } from '../../../shared/ipc-types'

export function getAllWorkspaces(): WorkspaceRow[] {
  return db.select().from(workspaces).all()
}

export function getWorkspaceById(workspaceId: string): WorkspaceRow | undefined {
  return db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()
}

export function getWorkspacesByProject(projectId: string): WorkspaceRow[] {
  return db.select().from(workspaces).where(eq(workspaces.projectId, projectId)).all()
}

export function insertWorkspace(row: WorkspaceRow): void {
  db.insert(workspaces).values(row).run()
}

export function updateWorkspaceLifecycleStatus(
  workspaceId: string,
  lifecycleStatus: WorkspaceLifecycleStatus
): void {
  db.update(workspaces)
    .set({
      lifecycleStatus,
      lifecycleStatusChangedAt: Date.now(),
      updatedAt: Date.now()
    })
    .where(eq(workspaces.id, workspaceId))
    .run()
}

// ─── Workspace ↔ Repo links ──────────────────────────────────────────────────

export type WorkspaceRepoJoin = RepositoryRow & { sourceBranch: string | null }

export function getReposByWorkspace(workspaceId: string): WorkspaceRepoJoin[] {
  const links = db
    .select()
    .from(workspaceRepos)
    .where(eq(workspaceRepos.workspaceId, workspaceId))
    .all()

  if (links.length === 0) return []

  const repos = db
    .select()
    .from(repositories)
    .where(
      inArray(
        repositories.id,
        links.map((l) => l.repoId)
      )
    )
    .all()

  const branchByRepoId = new Map(links.map((l) => [l.repoId, l.sourceBranch]))

  return repos.map((r) => ({ ...r, sourceBranch: branchByRepoId.get(r.id) ?? null }))
}

export function linkRepoToWorkspace(
  workspaceId: string,
  repoId: string,
  sourceBranch: string | null
): void {
  db.insert(workspaceRepos)
    .values({ workspaceId, repoId, sourceBranch })
    .onConflictDoNothing()
    .run()
}

/**
 * Links every repo belonging to the project. Mirrors the backend behaviour of
 * auto-linking project repos when a workspace is created without an explicit list.
 */
export function linkAllProjectRepos(
  workspaceId: string,
  projectId: string,
  sourceBranch: string | null
): void {
  const links = db
    .select({ repoId: projectRepositories.repoId })
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, projectId))
    .all()

  for (const { repoId } of links) {
    linkRepoToWorkspace(workspaceId, repoId, sourceBranch)
  }
}
