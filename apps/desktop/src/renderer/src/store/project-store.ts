import { create } from 'zustand'
import type { ProjectSetupStatus, ProjectWithRepos } from '../../../shared/ipc-types'
import { ipc } from '../lib/ipc'

type ProjectStore = {
  projects: ProjectWithRepos[]
  // Filesystem-truth setup status per project. Null/absent means "not yet fetched".
  setupStatuses: Map<string, ProjectSetupStatus>
  setProjects: (projects: ProjectWithRepos[]) => void
  addProject: (project: ProjectWithRepos) => void
  updateProject: (project: ProjectWithRepos) => void
  removeProject: (projectId: string) => void
  setSetupStatus: (projectId: string, status: ProjectSetupStatus) => void
  // Fetches fresh status from main (filesystem check) and stores it. Returns the status.
  refreshSetupStatus: (projectId: string) => Promise<ProjectSetupStatus | null>
  reset: () => void
}

// Sort projects by creation time ascending — oldest first, so newly-added
// projects always append to the bottom and the sidebar order stays stable
// across sessions. (TODO: move this sort to the backend once the API gets
// its own `orderBy: createdAt asc` so every client agrees without this shim.)
function sortByCreatedAt(projects: ProjectWithRepos[]): ProjectWithRepos[] {
  return [...projects].sort((a, b) => a.createdAt - b.createdAt)
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  setupStatuses: new Map(),

  setProjects: (projects) => set({ projects: sortByCreatedAt(projects) }),

  addProject: (project) =>
    set((state) => ({ projects: sortByCreatedAt([...state.projects, project]) })),

  updateProject: (project) =>
    set((state) => ({
      projects: sortByCreatedAt(
        state.projects.map((p) => (p.id === project.id ? project : p))
      )
    })),

  removeProject: (projectId) =>
    set((state) => {
      const nextSetup = new Map(state.setupStatuses)
      nextSetup.delete(projectId)
      return {
        projects: state.projects.filter((p) => p.id !== projectId),
        setupStatuses: nextSetup
      }
    }),

  setSetupStatus: (projectId, status) =>
    set((state) => {
      const next = new Map(state.setupStatuses)
      next.set(projectId, status)
      return { setupStatuses: next }
    }),

  refreshSetupStatus: async (projectId) => {
    try {
      const status = await ipc.projects.getSetupStatus(projectId)
      get().setSetupStatus(projectId, status)
      return status
    } catch {
      // Don't poison the cache on transient IPC failures.
      return get().setupStatuses.get(projectId) ?? null
    }
  },

  reset: () => set({ projects: [], setupStatuses: new Map() })
}))
