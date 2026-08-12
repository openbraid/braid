// ─── Repository interfaces ─────────────────────────────────────────────────
//
// Services depend ONLY on these interfaces — never on SQLite or any HTTP client
// directly. To swap the backend, implement the interface and update index.ts.
//
// Cloud layer (workspaces, projects, repos) → will move to backend API
// Local layer (workspaceLocal, projectPaths) → stays in SQLite forever
//
// WorkspaceWithLocal is a join of cloud + local: the service layer merges them.
// When the backend is live, WorkspaceRepository fetches cloud from API and
// local from SQLite, then merges — callers see the same WorkspaceWithLocal type.
//
// All methods return Promises to support both sync (SQLite) and async (HTTP)
// implementations transparently.

import type {
  ProjectWithRepos,
  ProjectSettings,
  WorkspaceWithLocal,
  WorkspaceStatus,
  WorkspaceBrokenReasonCode,
  WorkspaceLifecycleStatus
} from '../../shared/ipc-types'
import type { Repository } from '../db/schema'

// ─── Projects ────────────────────────────────────────────────────────────────

export interface IProjectRepository {
  getAll(): Promise<ProjectWithRepos[]>
  getLocalPath(projectId: string): Promise<string | null>
  create(
    name: string,
    repos?: Array<{ name: string; remoteUrl: string }>
  ): Promise<ProjectWithRepos>
  delete(projectId: string): Promise<void>

  // Project configuration. These sit on IProjectRepository rather than in their
  // own interface because they are project-scoped state on both sides — one
  // fewer abstraction to keep in step when the implementations change.
  getSettings(projectId: string): Promise<ProjectSettings>
  updateSettings(
    projectId: string,
    patch: { artifactsEnabled?: boolean; selectedAgents?: string[] }
  ): Promise<ProjectSettings>

  getMonitoredCommands(projectId: string): Promise<string[]>
  addMonitoredCommand(projectId: string, command: string): Promise<void>
  removeMonitoredCommand(projectId: string, command: string): Promise<void>
}

// ─── Agent instructions ──────────────────────────────────────────────────────

/**
 * The instruction text injected into each agent's rules directory so agents
 * discover the artifact files.
 *
 * Local mode reads the copy bundled with the app; team mode fetches the
 * server's, so guidance can be updated centrally without shipping a desktop
 * release. Same content, different source of truth — exactly what this split
 * is for. It must never fail in local mode: the injection is a headline
 * feature, not a server add-on.
 */
export interface IInstructionRepository {
  getAgentInstructions(): Promise<string>
}

// ─── Workspaces ───────────────────────────────────────────────────────────────

export interface IWorkspaceRepository {
  getAll(): Promise<WorkspaceWithLocal[]>
  getById(workspaceId: string): Promise<WorkspaceWithLocal | undefined>
  getByProject(projectId: string): Promise<WorkspaceWithLocal[]>
  create(data: {
    projectId: string
    name: string
    branchName: string
    sourceBranch: string
    repos?: Array<{ repoId: string; sourceBranch?: string }>
  }): Promise<WorkspaceWithLocal>
  updateStatus(workspaceId: string, status: WorkspaceStatus): Promise<void>
  markBroken(workspaceId: string, reason: WorkspaceBrokenReasonCode): Promise<void>
  updateLastOpened(workspaceId: string): Promise<void>
  updateLifecycleStatus(
    workspaceId: string,
    lifecycleStatus: WorkspaceLifecycleStatus
  ): Promise<void>
}

// ─── Workspace↔Repo join ──────────────────────────────────────────────────────

export type WorkspaceRepoWithSourceBranch = Repository & {
  sourceBranch: string | null
}

export interface IWorkspaceRepoRepository {
  getReposByWorkspace(workspaceId: string): Promise<WorkspaceRepoWithSourceBranch[]>
  linkReposForProject(workspaceId: string, projectId: string): Promise<void>
  linkRepos(workspaceId: string, repoIds: string[]): Promise<void>
}

// ─── Git repositories ─────────────────────────────────────────────────────────

export interface IRepositoryRepository {
  getByProject(projectId: string): Promise<Repository[]>
}
