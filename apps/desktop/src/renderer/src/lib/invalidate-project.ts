// ─── Project invalidation cascade ────────────────────────────────────────────
//
// A project can disappear for two reasons from this client's perspective:
//  - It was deleted (by the owner on this or another machine)
//  - The user was removed from contributors (owner revoked their access)
//
// Both flows do the same local cleanup: drop workspaces + tabs, clear setup
// status, navigate home if we were inside the project, then toast the user.
//
// Invoked from three call sites:
//  - PROJECT_DELETED listener (App.tsx)       — this client initiated it
//  - window-focus sync (App.tsx)              — project vanished server-side
//  - project-scoped IPC errors                — 404/403 via typed error code

import { toast } from 'sonner'
import { useProjectStore } from '../store/project-store'
import { useWorkspaceStore } from '../store/workspace-store'

export type InvalidationReason = 'deleted' | 'access_revoked'

export function invalidateProject(
  projectId: string,
  projectName: string,
  reason: InvalidationReason
): void {
  const workspaceStore = useWorkspaceStore.getState()
  const projectStore = useProjectStore.getState()

  workspaceStore.removeProjectWorkspaces(projectId)
  projectStore.removeProject(projectId)

  if (workspaceStore.activeProjectId === projectId) {
    workspaceStore.setActiveProjectId(null)
    workspaceStore.setActiveView('home')
  }

  const message = reason === 'access_revoked'
    ? `You no longer have access to ${projectName}`
    : `${projectName} has been deleted`
  toast(message)
}

// Branch on typed error codes surfaced via the IPC envelope (preload throws
// plain `{ code, message }`). Returns true if the error was recognized and
// handled — callers can skip their default error UI in that case.
export function handleProjectScopedError(
  err: unknown,
  projectId: string,
  projectName: string
): boolean {
  const code = (err as { code?: string } | null)?.code
  if (code === 'PROJECT_NOT_FOUND') {
    invalidateProject(projectId, projectName, 'deleted')
    return true
  }
  if (code === 'ACCESS_DENIED') {
    invalidateProject(projectId, projectName, 'access_revoked')
    return true
  }
  return false
}
