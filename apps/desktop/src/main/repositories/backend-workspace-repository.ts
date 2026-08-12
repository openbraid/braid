import type { IWorkspaceRepository } from './interfaces'
import {
  WorkspaceLifecycleStatus,
  type WorkspaceWithLocal,
  type WorkspaceStatus,
  type WorkspaceBrokenReasonCode
} from '../../shared/ipc-types'
import type { ApiWorkspace } from '../lib/api-types'
import { apiClient } from '../lib/api-client'
import {
  getAllWorkspaceLocalRows,
  getWorkspaceLocalRow,
  insertWorkspaceLocal,
  deleteWorkspaceLocal,
  updateWorkspaceLocalStatus,
  markWorkspaceLocalBroken,
  updateWorkspaceLocalLastOpened
} from '../db/queries/local'

export class BackendWorkspaceRepository implements IWorkspaceRepository {
  async getAll(): Promise<WorkspaceWithLocal[]> {
    const { data } = await apiClient.get<ApiWorkspace[]>('/workspaces')
    const localRows = getAllWorkspaceLocalRows()
    const localMap = new Map(localRows.map((r) => [r.workspaceId, r]))

    const result: WorkspaceWithLocal[] = []
    const seenIds = new Set<string>()

    for (const ws of data) {
      seenIds.add(ws.id)
      const local = localMap.get(ws.id)

      if (!local) {
        insertWorkspaceLocal(ws.id, 'closed_clean', null)
        result.push(
          merge(ws, {
            localStatus: 'closed_clean',
            brokenReason: null,
            lastOpenedAt: null,
            isPinned: 0
          })
        )
      } else {
        result.push(merge(ws, local))
      }
    }

    // Clean up orphaned local rows (workspace deleted remotely)
    for (const local of localRows) {
      if (!seenIds.has(local.workspaceId)) {
        deleteWorkspaceLocal(local.workspaceId)
      }
    }

    return result
  }

  async getById(workspaceId: string): Promise<WorkspaceWithLocal | undefined> {
    try {
      const { data } = await apiClient.get<ApiWorkspace>(`/workspaces/${workspaceId}`)
      let local = getWorkspaceLocalRow(workspaceId)

      if (!local) {
        insertWorkspaceLocal(workspaceId, 'closed_clean', null)
        local = getWorkspaceLocalRow(workspaceId)
      }

      return merge(data, local!)
    } catch (err: unknown) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404)
        return undefined
      throw err
    }
  }

  async getByProject(projectId: string): Promise<WorkspaceWithLocal[]> {
    const { data } = await apiClient.get<ApiWorkspace[]>('/workspaces', { params: { projectId } })

    return data.map((ws) => {
      let local = getWorkspaceLocalRow(ws.id)
      if (!local) {
        insertWorkspaceLocal(ws.id, 'closed_clean', null)
        local = getWorkspaceLocalRow(ws.id)
      }
      return merge(ws, local!)
    })
  }

  async create(data: {
    projectId: string
    name: string
    branchName: string
    sourceBranch: string
    repos?: Array<{ repoId: string; sourceBranch?: string }>
  }): Promise<WorkspaceWithLocal> {
    const { data: ws } = await apiClient.post<ApiWorkspace>('/workspaces', data)
    const now = Date.now()
    insertWorkspaceLocal(ws.id, 'open', now)
    return merge(ws, { localStatus: 'open', brokenReason: null, lastOpenedAt: now, isPinned: 0 })
  }

  // Local-only operations — only touch workspace_local in SQLite

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
    await apiClient.patch(`/workspaces/${workspaceId}/lifecycle-status`, { lifecycleStatus })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface LocalData {
  localStatus: string
  brokenReason: string | null
  lastOpenedAt: number | null
  isPinned: number
}

function merge(api: ApiWorkspace, local: LocalData): WorkspaceWithLocal {
  return {
    id: api.id,
    projectId: api.projectId,
    name: api.name,
    sanitizedName: api.sanitizedName,
    branchName: api.branchName,
    sourceBranch: api.sourceBranch,
    createdBy: api.createdBy,
    ownerName: api.ownerName ?? 'Unknown',
    createdAt: new Date(api.createdAt).getTime(),
    updatedAt: new Date(api.updatedAt).getTime(),
    lifecycleStatus: (api.lifecycleStatus ??
      WorkspaceLifecycleStatus.InProgress) as WorkspaceLifecycleStatus,
    lifecycleStatusChangedByFirstName: api.lifecycleStatusChangedByFirstName ?? null,
    lifecycleStatusChangedByLastName: api.lifecycleStatusChangedByLastName ?? null,
    lifecycleStatusChangedAt: api.lifecycleStatusChangedAt ?? null,
    status: local.localStatus as WorkspaceStatus,
    brokenReason: (local.brokenReason ?? null) as WorkspaceBrokenReasonCode | null,
    lastOpenedAt: local.lastOpenedAt,
    isPinned: local.isPinned === 1
  }
}
