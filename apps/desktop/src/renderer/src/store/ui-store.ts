import { create } from 'zustand'

export type ModalType =
  | 'add-project'
  | 'create-workspace'
  | 'close-workspace'
  | 'broken-workspace'
  | 'quit-warning'
  | 'settings'
  | 'workspace-list'
  | 'keyboard-shortcuts'
  | 'invite-contributor'
  | 'setup-script'
  | 'setup-project'
  | 'delete-project'

type ActiveTerminal = {
  workspaceName: string
  command: string
  status: 'running' | 'waiting'
}

type UncommittedWorkspace = {
  workspaceName: string
  repoName: string
  changedFiles: number
}

export type ModalContext =
  | { modal: 'create-workspace'; projectId: string; fromScratch?: boolean }
  | { modal: 'close-workspace'; workspaceId: string }
  | { modal: 'broken-workspace'; workspaceId: string }
  | { modal: 'workspace-list'; projectId: string }
  | { modal: 'invite-contributor'; projectId: string }
  | { modal: 'quit-warning'; activeTerminals: ActiveTerminal[]; uncommittedWorkspaces: UncommittedWorkspace[] }
  | { modal: 'setup-script'; output: string }
  | { modal: 'setup-project'; projectId: string }
  | { modal: 'delete-project'; projectId: string }
  | { modal: 'add-project' | 'settings' | 'keyboard-shortcuts' }

type UIStore = {
  leftPanelCollapsed: boolean
  // Sidebar projects the user has collapsed. Persisted to app-state.json so
  // the collapse state survives restarts (same pattern as leftPanelCollapsed).
  collapsedProjectIds: Set<string>
  activeModal: ModalType | null
  modalContext: ModalContext | null

  setLeftPanelCollapsed: (collapsed: boolean) => void
  setCollapsedProjectIds: (ids: string[]) => void
  openModal: (modal: ModalType, context?: ModalContext) => void
  closeModal: () => void
  reset: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  leftPanelCollapsed: false,
  collapsedProjectIds: new Set(),
  activeModal: null,
  modalContext: null,

  setLeftPanelCollapsed: (collapsed) => set({ leftPanelCollapsed: collapsed }),

  setCollapsedProjectIds: (ids) => set({ collapsedProjectIds: new Set(ids) }),

  openModal: (modal, context) =>
    set({ activeModal: modal, modalContext: context }),

  closeModal: () => set({ activeModal: null, modalContext: null }),

  reset: () => set({
    leftPanelCollapsed: false,
    collapsedProjectIds: new Set(),
    activeModal: null,
    modalContext: null
  })
}))
