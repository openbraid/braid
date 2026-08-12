import type { IRepositoryRepository } from './interfaces'
import type { Repository } from '../db/schema'
import type { ApiProject } from '../lib/api-types'
import { apiClient } from '../lib/api-client'

export class BackendRepositoryRepository implements IRepositoryRepository {
  async getByProject(projectId: string): Promise<Repository[]> {
    const { data } = await apiClient.get<ApiProject>(`/projects/${projectId}`)
    return data.repos.map((r) => ({
      id: r.id,
      name: r.name,
      remoteUrl: r.remoteUrl
    }))
  }
}
