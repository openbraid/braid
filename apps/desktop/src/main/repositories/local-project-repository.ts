import type { IProjectRepository } from './interfaces'
import type { ProjectWithRepos, ProjectSettings } from '../../shared/ipc-types'
import {
  getAllProjects,
  getProjectSettings,
  updateProjectSettings,
  getMonitoredCommands,
  addMonitoredCommand,
  removeMonitoredCommand,
  getReposByProject,
  insertProject,
  deleteProject,
  upsertRepository,
  linkRepoToProject,
  projectNameExists
} from '../db/queries/projects'
import { getProjectLocalPath, deleteProjectPath } from '../db/queries/local'
import type { ProjectRow } from '../db/schema'

export class LocalProjectRepository implements IProjectRepository {
  async getAll(): Promise<ProjectWithRepos[]> {
    return getAllProjects().map(toProjectWithRepos)
  }

  async getLocalPath(projectId: string): Promise<string | null> {
    return getProjectLocalPath(projectId)
  }

  async create(
    name: string,
    repos?: Array<{ name: string; remoteUrl: string }>
  ): Promise<ProjectWithRepos> {
    // Mirrors the backend's uniqueness constraint so both modes fail the same way.
    if (projectNameExists(name)) {
      const err = new Error(`A project named "${name}" already exists`) as Error & { code: string }
      err.code = 'PROJECT_NAME_TAKEN'
      throw err
    }

    const now = Date.now()
    const row: ProjectRow = {
      id: crypto.randomUUID(),
      name,
      // Same defaults as the column definitions and core-api's Project model:
      // artifacts on, no agents chosen yet.
      artifactsEnabled: 1,
      selectedAgents: '[]',
      createdAt: now,
      updatedAt: now
    }
    insertProject(row)

    for (const repo of repos ?? []) {
      const saved = upsertRepository(repo.name, repo.remoteUrl)
      linkRepoToProject(row.id, saved.id)
    }

    return toProjectWithRepos(row)
  }

  async getSettings(projectId: string): Promise<ProjectSettings> {
    // A project that vanished mid-flight should not crash the caller; the
    // defaults here match the column defaults and core-api's Project model.
    return getProjectSettings(projectId) ?? { artifactsEnabled: true, selectedAgents: [] }
  }

  async updateSettings(
    projectId: string,
    patch: { artifactsEnabled?: boolean; selectedAgents?: string[] }
  ): Promise<ProjectSettings> {
    updateProjectSettings(projectId, patch)
    return this.getSettings(projectId)
  }

  async getMonitoredCommands(projectId: string): Promise<string[]> {
    return getMonitoredCommands(projectId)
  }

  async addMonitoredCommand(projectId: string, command: string): Promise<void> {
    addMonitoredCommand(projectId, command)
  }

  async removeMonitoredCommand(projectId: string, command: string): Promise<void> {
    removeMonitoredCommand(projectId, command)
  }

  async delete(projectId: string): Promise<void> {
    // Repository rows are intentionally left behind — a repo may be linked to
    // another project, and orphans are harmless (keyed by remote_url).
    deleteProject(projectId)
    deleteProjectPath(projectId)
  }
}

function toProjectWithRepos(p: ProjectRow): ProjectWithRepos {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    localPath: getProjectLocalPath(p.id),
    repos: getReposByProject(p.id).map((r) => ({
      id: r.id,
      name: r.name,
      remoteUrl: r.remoteUrl
    }))
  }
}
