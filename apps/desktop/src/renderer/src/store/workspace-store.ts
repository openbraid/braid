import { create } from 'zustand'
import type { WorkspaceWithLocal } from '../../../shared/ipc-types'

export type ActiveView = 'home' | 'project' | 'workspace'

type WorkspaceStore = {
  workspaces: WorkspaceWithLocal[]
  openTabIds: string[]
  // Subset of openTabIds whose webview has been mounted (lazy — grows on first visit)
  initializedTabIds: Set<string>
  activeWorkspaceId: string | null
  activeView: ActiveView
  activeProjectId: string | null
  workspaceUrls: Map<string, string>
  // workspaceId → changed file count, populated by GIT_STATUS_UPDATED push events
  gitStatus: Map<string, number>
  // projectId → ordered workspace IDs matching the sidebar visual order.
  // Written by ProjectSection whenever its local order changes.
  sidebarOrder: Map<string, string[]>

  setWorkspaces: (workspaces: WorkspaceWithLocal[]) => void
  addWorkspace: (workspace: WorkspaceWithLocal) => void
  updateWorkspace: (id: string, patch: Partial<WorkspaceWithLocal>) => void
  removeProjectWorkspaces: (projectId: string) => void
  setOpenTabIds: (ids: string[]) => void
  openTab: (id: string) => void
  closeTab: (id: string) => void
  initializeTab: (id: string) => void
  setActiveWorkspace: (id: string) => void
  setActiveView: (view: ActiveView) => void
  setActiveProjectId: (id: string | null) => void
  setWorkspaceUrl: (workspaceId: string, url: string) => void
  setGitStatus: (workspaceId: string, changedFiles: number) => void
  setSidebarOrder: (projectId: string, ids: string[]) => void
  reset: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspaces: [],
  openTabIds: [],
  initializedTabIds: new Set(),
  activeWorkspaceId: null,
  activeView: 'home',
  activeProjectId: null,
  workspaceUrls: new Map(),
  gitStatus: new Map(),
  sidebarOrder: new Map(),

  setWorkspaces: (workspaces) => set({ workspaces }),

  addWorkspace: (workspace) =>
    set((state) => ({ workspaces: [...state.workspaces, workspace] })),

  updateWorkspace: (id, patch) =>
    set((state) => ({
      workspaces: state.workspaces.map((ws) => (ws.id === id ? { ...ws, ...patch } : ws))
    })),

  removeProjectWorkspaces: (projectId) =>
    set((state) => {
      const removedIds = new Set(
        state.workspaces.filter((ws) => ws.projectId === projectId).map((ws) => ws.id)
      )
      if (removedIds.size === 0) {
        // Still clean sidebarOrder in case of stale entry.
        const nextSidebarOrder = new Map(state.sidebarOrder)
        nextSidebarOrder.delete(projectId)
        return { sidebarOrder: nextSidebarOrder }
      }
      const nextInit = new Set(state.initializedTabIds)
      const nextUrls = new Map(state.workspaceUrls)
      const nextGitStatus = new Map(state.gitStatus)
      for (const id of removedIds) {
        nextInit.delete(id)
        nextUrls.delete(id)
        nextGitStatus.delete(id)
      }
      const nextSidebarOrder = new Map(state.sidebarOrder)
      nextSidebarOrder.delete(projectId)
      return {
        workspaces: state.workspaces.filter((ws) => !removedIds.has(ws.id)),
        openTabIds: state.openTabIds.filter((id) => !removedIds.has(id)),
        initializedTabIds: nextInit,
        workspaceUrls: nextUrls,
        gitStatus: nextGitStatus,
        sidebarOrder: nextSidebarOrder,
        activeWorkspaceId: state.activeWorkspaceId && removedIds.has(state.activeWorkspaceId)
          ? null
          : state.activeWorkspaceId
      }
    }),

  setOpenTabIds: (ids) => set({ openTabIds: ids }),

  openTab: (id) =>
    set((state) => {
      if (state.openTabIds.includes(id)) return state
      return { openTabIds: [...state.openTabIds, id] }
    }),

  closeTab: (id) =>
    set((state) => {
      const next = new Set(state.initializedTabIds)
      next.delete(id)
      return {
        openTabIds: state.openTabIds.filter((tabId) => tabId !== id),
        initializedTabIds: next
      }
    }),

  initializeTab: (id) =>
    set((state) => {
      if (state.initializedTabIds.has(id)) return state
      const next = new Set(state.initializedTabIds)
      next.add(id)
      return { initializedTabIds: next }
    }),

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id, activeView: 'workspace' }),

  setActiveView: (view) => set({ activeView: view }),

  setActiveProjectId: (id) => set({ activeProjectId: id }),

  setWorkspaceUrl: (workspaceId, url) =>
    set((state) => {
      const next = new Map(state.workspaceUrls)
      next.set(workspaceId, url)
      return { workspaceUrls: next }
    }),

  setGitStatus: (workspaceId, changedFiles) =>
    set((state) => {
      const next = new Map(state.gitStatus)
      next.set(workspaceId, changedFiles)
      return { gitStatus: next }
    }),

  setSidebarOrder: (projectId, ids) =>
    set((state) => {
      const next = new Map(state.sidebarOrder)
      next.set(projectId, ids)
      return { sidebarOrder: next }
    }),

  reset: () =>
    set({
      workspaces: [],
      openTabIds: [],
      initializedTabIds: new Set(),
      activeWorkspaceId: null,
      activeView: 'home',
      activeProjectId: null,
      workspaceUrls: new Map(),
      gitStatus: new Map(),
      sidebarOrder: new Map()
    })
}))
