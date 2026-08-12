import { create } from 'zustand'
import type { WorkspaceTerminalEntry } from '../../../shared/ipc-types'

type TerminalStore = {
  terminals: Map<string, WorkspaceTerminalEntry[]>
  setTerminals: (workspaceId: string, entries: WorkspaceTerminalEntry[]) => void
  clearWorkspace: (workspaceId: string) => void
  reset: () => void
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  terminals: new Map(),

  setTerminals: (workspaceId, entries) =>
    set((state) => {
      const next = new Map(state.terminals)
      next.set(workspaceId, entries)
      return { terminals: next }
    }),

  clearWorkspace: (workspaceId) =>
    set((state) => {
      const next = new Map(state.terminals)
      next.delete(workspaceId)
      return { terminals: next }
    }),

  reset: () => set({ terminals: new Map() })
}))
