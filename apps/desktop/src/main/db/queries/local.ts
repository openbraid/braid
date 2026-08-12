// ─── Local-only queries ──────────────────────────────────────────────────────
//
// These operate ONLY on local SQLite tables that never sync to backend:
//   - project_paths (machine-specific folder path)
//   - workspace_local (local status, pin, lastOpened)
//
// Used by both SQLite and Backend repository implementations.

import { eq } from 'drizzle-orm'
import { db } from '../index'
import { projectPaths, workspaceLocal } from '../schema'
import type { WorkspaceLocal } from '../schema'
import type { WorkspaceStatus, WorkspaceBrokenReasonCode } from '../../../shared/ipc-types'

// ─── Project Paths ───────────────────────────────────────────────────────────

export function getProjectLocalPath(projectId: string): string | null {
  const row = db
    .select({ localPath: projectPaths.localPath })
    .from(projectPaths)
    .where(eq(projectPaths.projectId, projectId))
    .get()
  return row?.localPath ?? null
}

export function setProjectLocalPath(projectId: string, localPath: string): void {
  db.insert(projectPaths).values({ projectId, localPath }).run()
}

// Insert or replace. Used by the "set up locally" flow, which may run both
// for fresh invited projects (no row) and recovery from a missing clone (row exists).
export function upsertProjectLocalPath(projectId: string, localPath: string): void {
  db.insert(projectPaths)
    .values({ projectId, localPath })
    .onConflictDoUpdate({ target: projectPaths.projectId, set: { localPath } })
    .run()
}

export function deleteProjectPath(projectId: string): void {
  db.delete(projectPaths).where(eq(projectPaths.projectId, projectId)).run()
}

// ─── Workspace Local ─────────────────────────────────────────────────────────

export function getAllWorkspaceLocalRows(): WorkspaceLocal[] {
  return db.select().from(workspaceLocal).all()
}

export function getWorkspaceLocalRow(workspaceId: string): WorkspaceLocal | undefined {
  return db
    .select()
    .from(workspaceLocal)
    .where(eq(workspaceLocal.workspaceId, workspaceId))
    .get()
}

export function insertWorkspaceLocal(
  workspaceId: string,
  status: WorkspaceStatus = 'open',
  lastOpenedAt: number | null = null
): void {
  db.insert(workspaceLocal)
    .values({
      workspaceId,
      localStatus: status,
      lastOpenedAt,
      isPinned: 0
    })
    .run()
}

export function deleteWorkspaceLocal(workspaceId: string): void {
  db.delete(workspaceLocal).where(eq(workspaceLocal.workspaceId, workspaceId)).run()
}

export function updateWorkspaceLocalStatus(workspaceId: string, status: WorkspaceStatus): void {
  db.update(workspaceLocal)
    .set({ localStatus: status, brokenReason: null })
    .where(eq(workspaceLocal.workspaceId, workspaceId))
    .run()
}

export function markWorkspaceLocalBroken(workspaceId: string, reason: WorkspaceBrokenReasonCode): void {
  db.update(workspaceLocal)
    .set({ localStatus: 'broken', brokenReason: reason })
    .where(eq(workspaceLocal.workspaceId, workspaceId))
    .run()
}

export function updateWorkspaceLocalLastOpened(workspaceId: string): void {
  db.update(workspaceLocal)
    .set({ lastOpenedAt: Date.now() })
    .where(eq(workspaceLocal.workspaceId, workspaceId))
    .run()
}

export function updateWorkspaceLocalPinned(workspaceId: string, isPinned: boolean): void {
  db.update(workspaceLocal)
    .set({ isPinned: isPinned ? 1 : 0 })
    .where(eq(workspaceLocal.workspaceId, workspaceId))
    .run()
}
