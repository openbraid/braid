import type { IWorkspaceRepoRepository, WorkspaceRepoWithSourceBranch } from './interfaces'
import type { ApiWorkspace } from '../lib/api-types'
import { apiClient } from '../lib/api-client'

export class BackendWorkspaceRepoRepository implements IWorkspaceRepoRepository {
  async getReposByWorkspace(workspaceId: string): Promise<WorkspaceRepoWithSourceBranch[]> {
    const { data } = await apiClient.get<ApiWorkspace>(`/workspaces/${workspaceId}`)
    return data.repos.map((r) => ({
      id: r.id,
      name: r.name,
      remoteUrl: r.remoteUrl,
      sourceBranch: r.sourceBranch ?? null
    }))
  }

  async linkReposForProject(_workspaceId: string, _projectId: string): Promise<void> {
    // No-op — the backend auto-links project repos during workspace creation
    // when repos is not provided.
  }

  async linkRepos(workspaceId: string, repoIds: string[]): Promise<void> {
    for (const repoId of repoIds) {
      await apiClient.post(`/workspaces/${workspaceId}/repos`, { repoId })
    }
  }
}
