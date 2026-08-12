import type { IRepositoryRepository } from './interfaces'
import type { Repository } from '../db/schema'
import { getReposByProject } from '../db/queries/projects'

export class LocalRepositoryRepository implements IRepositoryRepository {
  async getByProject(projectId: string): Promise<Repository[]> {
    return getReposByProject(projectId).map((r) => ({
      id: r.id,
      name: r.name,
      remoteUrl: r.remoteUrl
    }))
  }
}
