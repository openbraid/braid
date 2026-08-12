import type { IProjectRepository } from './interfaces'
import type { ProjectWithRepos, ProjectSettings } from '../../shared/ipc-types'
import type { ApiProject } from '../lib/api-types'
import { apiClient } from '../lib/api-client'
import { getProjectLocalPath, deleteProjectPath } from '../db/queries/local'

export class BackendProjectRepository implements IProjectRepository {
  async getAll(): Promise<ProjectWithRepos[]> {
    const { data } = await apiClient.get<ApiProject[]>('/projects')
    return data.map(toProjectWithRepos)
  }

  async getLocalPath(projectId: string): Promise<string | null> {
    return getProjectLocalPath(projectId)
  }

  async create(
    name: string,
    repos?: Array<{ name: string; remoteUrl: string }>
  ): Promise<ProjectWithRepos> {
    const { data } = await apiClient.post<ApiProject>('/projects', {
      name,
      repos: repos ?? []
    })
    return toProjectWithRepos(data)
  }

  async delete(projectId: string): Promise<void> {
    await apiClient.delete(`/projects/${projectId}`)
    deleteProjectPath(projectId)
  }

  async getSettings(projectId: string): Promise<ProjectSettings> {
    const { data } = await apiClient.get<ProjectSettings>(`/projects/${projectId}/settings`)
    return data
  }

  async updateSettings(
    projectId: string,
    patch: { artifactsEnabled?: boolean; selectedAgents?: string[] }
  ): Promise<ProjectSettings> {
    const { data } = await apiClient.patch<ProjectSettings>(
      `/projects/${projectId}/settings`,
      patch
    )
    return data
  }

  async getMonitoredCommands(projectId: string): Promise<string[]> {
    const { data } = await apiClient.get<string[]>(`/projects/${projectId}/monitored-commands`)
    return data
  }

  async addMonitoredCommand(projectId: string, command: string): Promise<void> {
    await apiClient.post(`/projects/${projectId}/monitored-commands`, { command })
  }

  async removeMonitoredCommand(projectId: string, command: string): Promise<void> {
    await apiClient.delete(
      `/projects/${projectId}/monitored-commands/${encodeURIComponent(command)}`
    )
  }
}

function toProjectWithRepos(p: ApiProject): ProjectWithRepos {
  return {
    id: p.id,
    name: p.name,
    createdAt: new Date(p.createdAt).getTime(),
    updatedAt: new Date(p.updatedAt).getTime(),
    localPath: getProjectLocalPath(p.id),
    repos: p.repos.map((r) => ({ id: r.id, name: r.name, remoteUrl: r.remoteUrl }))
  }
}
