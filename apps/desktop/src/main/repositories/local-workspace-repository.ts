import type { IWorkspaceRepository } from './interfaces'
import {
  WorkspaceLifecycleStatus,
  type WorkspaceWithLocal,
  type WorkspaceStatus,
  type WorkspaceBrokenReasonCode
} from '../../shared/ipc-types'
import {
  getAllWorkspaces,
  getWorkspaceById,
  getWorkspacesByProject,
  insertWorkspace,
  updateWorkspaceLifecycleStatus,
  linkAllProjectRepos,
  linkRepoToWorkspace
} from '../db/queries/workspaces'
import {
  getAllWorkspaceLocalRows,
  getWorkspaceLocalRow,
  insertWorkspaceLocal,
  updateWorkspaceLocalStatus,
  markWorkspaceLocalBroken,
  updateWorkspaceLocalLastOpened
} from '../db/queries/local'
import { getLocalUser } from '../lib/local-user'
import { sanitizeBranchName } from '../lib/git'
import type { WorkspaceRow } from '../db/schema'

export class LocalWorkspaceRepository implements IWorkspaceRepository {
  async getAll(): Promise<WorkspaceWithLocal[]> {
    const rows = getAllWorkspaces()
    const localMap = new Map(getAllWorkspaceLocalRows().map((r) => [r.workspaceId, r]))

    // Deliberately no orphan cleanup here. The backend implementation prunes
    // local rows with no matching remote workspace, because there the server is
    // authoritative and a missing workspace genuinely means "deleted elsewhere".
    // Locally there is no elsewhere: an unmatched row means either data written
    // under a previous configuration or a bug, and in both cases silently
    // deleting the user's pins and history is the wrong answer. Stale rows are
    // inert — they are keyed by workspace id and simply never read.
    return rows.map((ws) => merge(ws, localMap.get(ws.id) ?? ensureLocalRow(ws.id)))
  }

  async getById(workspaceId: string): Promise<WorkspaceWithLocal | undefined> {
    const ws = getWorkspaceById(workspaceId)
    if (!ws) return undefined
    return merge(ws, getWorkspaceLocalRow(workspaceId) ?? ensureLocalRow(workspaceId))
  }

  async getByProject(projectId: string): Promise<WorkspaceWithLocal[]> {
    return getWorkspacesByProject(projectId).map((ws) =>
      merge(ws, getWorkspaceLocalRow(ws.id) ?? ensureLocalRow(ws.id))
    )
  }

  async create(data: {
    projectId: string
    name: string
    branchName: string
    sourceBranch: string
    repos?: Array<{ repoId: string; sourceBranch?: string }>
  }): Promise<WorkspaceWithLocal> {
    const now = Date.now()
    const user = getLocalUser()

    const row: WorkspaceRow = {
      id: crypto.randomUUID(),
      projectId: data.projectId,
      name: data.name,
      sanitizedName: sanitizeBranchName(data.name),
      branchName: data.branchName,
      sourceBranch: data.sourceBranch,
      createdBy: user.id,
      ownerName: user.displayName,
      lifecycleStatus: WorkspaceLifecycleStatus.InProgress,
      lifecycleStatusChangedAt: null,
      createdAt: now,
      updatedAt: now
    }
    insertWorkspace(row)

    // Matches the backend: an explicit repo list wins, otherwise every repo in
    // the project is linked.
    if (data.repos && data.repos.length > 0) {
      for (const r of data.repos) {
        linkRepoToWorkspace(row.id, r.repoId, r.sourceBranch ?? data.sourceBranch)
      }
    } else {
      linkAllProjectRepos(row.id, data.projectId, data.sourceBranch)
    }

    insertWorkspaceLocal(row.id, 'open', now)
    return merge(row, { localStatus: 'open', brokenReason: null, lastOpenedAt: now, isPinned: 0 })
  }

  // ─── Local-only operations ─────────────────────────────────────────────────

  async updateStatus(workspaceId: string, status: WorkspaceStatus): Promise<void> {
    updateWorkspaceLocalStatus(workspaceId, status)
  }

  async markBroken(workspaceId: string, reason: WorkspaceBrokenReasonCode): Promise<void> {
    markWorkspaceLocalBroken(workspaceId, reason)
  }

  async updateLastOpened(workspaceId: string): Promise<void> {
    updateWorkspaceLocalLastOpened(workspaceId)
  }

  async updateLifecycleStatus(
    workspaceId: string,
    lifecycleStatus: WorkspaceLifecycleStatus
  ): Promise<void> {
    updateWorkspaceLifecycleStatus(workspaceId, lifecycleStatus)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface LocalData {
  localStatus: string
  brokenReason: string | null
  lastOpenedAt: number | null
  isPinned: number
}

function ensureLocalRow(workspaceId: string): LocalData {
  insertWorkspaceLocal(workspaceId, 'closed_clean', null)
  return { localStatus: 'closed_clean', brokenReason: null, lastOpenedAt: null, isPinned: 0 }
}

function merge(ws: WorkspaceRow, local: LocalData): WorkspaceWithLocal {
  const user = getLocalUser()
  const isOwner = ws.createdBy === user.id

  return {
    id: ws.id,
    projectId: ws.projectId,
    name: ws.name,
    sanitizedName: ws.sanitizedName,
    branchName: ws.branchName,
    sourceBranch: ws.sourceBranch,
    createdBy: ws.createdBy,
    ownerName: ws.ownerName,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
    lifecycleStatus: ws.lifecycleStatus as WorkspaceLifecycleStatus,
    // Single-user mode: any lifecycle change was made by the local user.
    lifecycleStatusChangedByFirstName:
      ws.lifecycleStatusChangedAt && isOwner ? user.firstName : null,
    lifecycleStatusChangedByLastName: ws.lifecycleStatusChangedAt && isOwner ? user.lastName : null,
    lifecycleStatusChangedAt: ws.lifecycleStatusChangedAt
      ? new Date(ws.lifecycleStatusChangedAt).toISOString()
      : null,
    status: local.localStatus as WorkspaceStatus,
    brokenReason: (local.brokenReason ?? null) as WorkspaceBrokenReasonCode | null,
    lastOpenedAt: local.lastOpenedAt,
    isPinned: local.isPinned === 1
  }
}
