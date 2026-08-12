import type { IWorkspaceRepoRepository, WorkspaceRepoWithSourceBranch } from './interfaces'
import {
  getReposByWorkspace,
  linkRepoToWorkspace,
  linkAllProjectRepos,
  getWorkspaceById
} from '../db/queries/workspaces'

export class LocalWorkspaceRepoRepository implements IWorkspaceRepoRepository {
  async getReposByWorkspace(workspaceId: string): Promise<WorkspaceRepoWithSourceBranch[]> {
    return getReposByWorkspace(workspaceId).map((r) => ({
      id: r.id,
      name: r.name,
      remoteUrl: r.remoteUrl,
      sourceBranch: r.sourceBranch
    }))
  }

  async linkReposForProject(workspaceId: string, projectId: string): Promise<void> {
    const ws = getWorkspaceById(workspaceId)
    linkAllProjectRepos(workspaceId, projectId, ws?.sourceBranch ?? null)
  }

  async linkRepos(workspaceId: string, repoIds: string[]): Promise<void> {
    const ws = getWorkspaceById(workspaceId)
    for (const repoId of repoIds) {
      linkRepoToWorkspace(workspaceId, repoId, ws?.sourceBranch ?? null)
    }
  }
}
